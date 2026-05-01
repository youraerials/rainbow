/**
 * OIDC client for Authentik. Handles:
 *   - Discovery of issuer endpoints (cached)
 *   - JWKS-based JWT verification (cached)
 *   - Authorization-code exchange for the login callback
 *
 * The Express middleware in middleware.ts uses these primitives.
 */

import { createRemoteJWKSet, jwtVerify, JWTPayload, decodeJwt } from "jose";

export interface OidcConfig {
    issuer: string;          // e.g. https://test-auth.rainbow.rocks/application/o/web/
    clientId: string;
    clientSecret: string;
    redirectUri: string;     // https://test-app.rainbow.rocks/api/auth/callback
}

export interface RainbowUser {
    sub: string;             // Authentik user id (hashed)
    email?: string;
    name?: string;
    preferredUsername?: string;
    raw: JWTPayload;
}

interface DiscoveryDoc {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    jwks_uri: string;
}

interface CachedConfig {
    config: OidcConfig;
    discovery: DiscoveryDoc;
    jwks: ReturnType<typeof createRemoteJWKSet>;
}

let cached: CachedConfig | null = null;

/**
 * Fetch the issuer's OIDC discovery document. Authentik's per-provider
 * issuer mode means the issuer URL is `<host>/application/o/<slug>/`, but
 * the authorize/token/userinfo endpoints DON'T sit under that path — they
 * live at `<host>/application/o/authorize/`, etc. We can only know that by
 * reading discovery.
 *
 * Retries with backoff: the web container starts before cloudflared has
 * registered with Cloudflare's edge, so the public URL initially returns
 * 530. We wait up to ~90s for the tunnel to come online.
 */
export async function configureOidc(config: OidcConfig): Promise<void> {
    const issuer = config.issuer.replace(/\/+$/, "/");
    const wellKnown = new URL(`${issuer}.well-known/openid-configuration`);

    const maxAttempts = 45;
    const backoffMs = 2000;
    let lastError = "no attempts made";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const resp = await fetch(wellKnown);
            if (resp.ok) {
                const discovery = (await resp.json()) as DiscoveryDoc;
                cached = {
                    config: { ...config, issuer },
                    discovery,
                    jwks: createRemoteJWKSet(new URL(discovery.jwks_uri)),
                };
                console.log(`[auth] OIDC configured for ${issuer}`);
                console.log(`[auth]   authorization_endpoint: ${discovery.authorization_endpoint}`);
                console.log(`[auth]   token_endpoint:         ${discovery.token_endpoint}`);
                return;
            }
            lastError = `HTTP ${resp.status}`;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
        if (attempt === 1) {
            console.log(`[auth] waiting for OIDC issuer at ${issuer} (${lastError})`);
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    throw new Error(`OIDC discovery failed after ${maxAttempts} attempts: ${lastError}`);
}

function ensureConfigured(): CachedConfig {
    if (!cached) throw new Error("OIDC not configured — call configureOidc first");
    return cached;
}

export function getConfig(): OidcConfig {
    return ensureConfigured().config;
}

/**
 * Verify a JWT (id_token or access_token) against the issuer's JWKS.
 * Throws if signature, issuer, audience, or expiry checks fail.
 */
export async function verifyJwt(token: string): Promise<RainbowUser> {
    const { config, jwks } = ensureConfigured();
    const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
    });
    return userFromPayload(payload);
}

function userFromPayload(payload: JWTPayload): RainbowUser {
    return {
        sub: String(payload.sub ?? ""),
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        preferredUsername:
            typeof payload.preferred_username === "string"
                ? payload.preferred_username
                : undefined,
        raw: payload,
    };
}

/**
 * Build the Authentik authorization URL the user gets redirected to.
 * `state` is a CSRF guard — caller stores it (e.g. cookie) and verifies on callback.
 */
export function buildAuthorizeUrl(state: string, scope = "openid email profile"): string {
    const { config, discovery } = ensureConfigured();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    return url.toString();
}

interface TokenResponse {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
}

/**
 * Exchange an authorization code for tokens. Verifies the resulting id_token.
 */
export async function exchangeCode(code: string): Promise<{
    user: RainbowUser;
    idToken: string;
    accessToken: string;
}> {
    const { config, discovery } = ensureConfigured();
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    });
    const resp = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`token exchange failed (HTTP ${resp.status}): ${text}`);
    }
    const json = (await resp.json()) as TokenResponse;
    const user = await verifyJwt(json.id_token);
    return { user, idToken: json.id_token, accessToken: json.access_token };
}

/** Decode without verification — only for logging / debug. Never trust this. */
export function unsafeDecode(token: string): JWTPayload {
    return decodeJwt(token);
}
