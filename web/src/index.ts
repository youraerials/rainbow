/**
 * Rainbow web tier.
 *
 * Single Express app serving:
 *   - /                → dashboard SPA (static, mounted at runtime from dashboard/dist)
 *   - /api/auth/*      → OIDC login flow (public)
 *   - /api/...         → admin REST endpoints (auth-required)
 *   - /mcp             → MCP HTTP transport (auth-required)
 *   - /apps/<name>/*   → user-generated apps loaded from a persistent volume (future)
 *
 * Runs in the rainbow-web container; reachable via Caddy at <prefix>-app.<zone>.
 */

import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";

import { apiRouter } from "./api/index.js";
import { attachMcp } from "./mcp/server.js";
import { configureOidc } from "./auth/oidc.js";
import { requireAuth } from "./auth/middleware.js";

const PORT = Number(process.env.PORT ?? 3000);
const DASHBOARD_DIR = process.env.RAINBOW_DASHBOARD_DIR ?? "/usr/share/web/dashboard";
const APPS_DIR = process.env.RAINBOW_APPS_DIR ?? "/var/lib/rainbow/apps";

// OIDC config from env, set up by the orchestrator from Keychain.
const HOST_PREFIX = process.env.RAINBOW_HOST_PREFIX ?? "";
const ZONE = process.env.RAINBOW_ZONE ?? "";
const WEB_HOST =
    process.env.RAINBOW_WEB_HOST ??
    (HOST_PREFIX ? `${HOST_PREFIX.replace(/-$/, "")}.${ZONE}` : ZONE);
const CLIENT_ID = process.env.RAINBOW_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.RAINBOW_OAUTH_CLIENT_SECRET ?? "";
const ISSUER =
    process.env.RAINBOW_OAUTH_ISSUER ??
    (ZONE ? `https://${HOST_PREFIX}auth.${ZONE}/application/o/web/` : "");
const REDIRECT_URI =
    process.env.RAINBOW_OAUTH_REDIRECT_URI ??
    (WEB_HOST ? `https://${WEB_HOST}/api/auth/callback` : "");

if (!CLIENT_ID || !CLIENT_SECRET || !ISSUER || !REDIRECT_URI) {
    console.error("[rainbow-web] FATAL: OIDC env not fully populated.");
    console.error("  RAINBOW_OAUTH_CLIENT_ID / _CLIENT_SECRET must be set,");
    console.error("  along with RAINBOW_HOST_PREFIX + RAINBOW_ZONE (or RAINBOW_OAUTH_ISSUER explicitly).");
    process.exit(1);
}

await configureOidc({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
});

const app = express();
app.set("trust proxy", true); // we're behind Caddy + Cloudflare Tunnel
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

// REST first (auth/* is public; rest require auth via the router itself).
app.use("/api", apiRouter);

// MCP requires auth.
attachMcp(app, "/mcp", requireAuth);

// Lock down the dashboard: an unauthenticated visitor sees nothing and is
// redirected to the login flow. Rainbow is single-user private infrastructure;
// there's no reason for anonymous traffic to see even the React bundle.
// /api/* handles its own auth (login routes are public); /mcp 401s rather than
// redirecting (it's a JSON API, not a browser route).
app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/mcp")) return next();
    const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies;
    if (cookies?.rainbow_session) return next();
    res.redirect("/api/auth/login");
});

// Static dashboard, with SPA fallback for client-side routes. Express 5
// dropped support for bare-`*` route patterns, so we use a path-less
// middleware after express.static.
app.use(express.static(DASHBOARD_DIR, { index: "index.html" }));
app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/mcp")) return next();
    res.sendFile(path.join(DASHBOARD_DIR, "index.html"));
});

app.listen(PORT, () => {
    console.log(`[rainbow-web] listening on :${PORT}`);
    console.log(`[rainbow-web]   dashboard: ${DASHBOARD_DIR}`);
    console.log(`[rainbow-web]   apps:      ${APPS_DIR}`);
});
