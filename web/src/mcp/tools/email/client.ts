/**
 * Thin JMAP client for Stalwart. JMAP is RPC-over-JSON, so a single helper
 * (`jmap()`) suffices: it resolves the session, picks the API URL + accountId,
 * and submits one or more method calls.
 *
 * Auth: Basic with STALWART_JMAP_USER + STALWART_JMAP_PASSWORD. These are
 * provisioned by the user (see services/stalwart/README.md) into macOS
 * Keychain and injected into the rainbow-web container by the orchestrator.
 *
 * If either env var is missing, isConfigured() returns false and the email
 * tools refuse to register.
 */

import { publicUrl } from "../../../services/registry.js";

const USER = process.env.STALWART_JMAP_USER ?? "";
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? "";

export function isConfigured(): boolean {
    return Boolean(USER && PASSWORD);
}

function authHeader(): string {
    return "Basic " + Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
}

interface JmapSession {
    apiUrl: string;
    primaryAccounts?: Record<string, string>;
}

let cachedSession: JmapSession | null = null;
let cachedAccountId: string | null = null;

async function fetchSession(): Promise<JmapSession> {
    if (cachedSession) return cachedSession;
    const url = publicUrl("mail", "/.well-known/jmap");
    const resp = await fetch(url, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!resp.ok) {
        throw new Error(`JMAP session fetch failed: HTTP ${resp.status}`);
    }
    const session = (await resp.json()) as JmapSession;
    cachedSession = session;
    return session;
}

export async function accountId(): Promise<string> {
    if (cachedAccountId) return cachedAccountId;
    const session = await fetchSession();
    const id =
        session.primaryAccounts?.["urn:ietf:params:jmap:mail"] ??
        Object.values(session.primaryAccounts ?? {})[0];
    if (!id) throw new Error("no JMAP mail account in session");
    cachedAccountId = id;
    return id;
}

// One JMAP method call: [name, args, callId]
export type JmapCall = [string, Record<string, unknown>, string];

interface JmapResponse {
    methodResponses: JmapCall[];
}

export interface JmapResult<T> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export async function jmap<T = unknown>(
    methodCalls: JmapCall[],
    timeoutMs = 10000,
): Promise<JmapResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const session = await fetchSession();
        const body = {
            using: [
                "urn:ietf:params:jmap:core",
                "urn:ietf:params:jmap:mail",
                "urn:ietf:params:jmap:submission",
            ],
            methodCalls,
        };
        const resp = await fetch(session.apiUrl, {
            method: "POST",
            headers: {
                Authorization: authHeader(),
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await resp.text();
        if (!resp.ok) {
            return { ok: false, status: resp.status, error: text };
        }
        const parsed = JSON.parse(text) as JmapResponse;
        return { ok: true, status: resp.status, data: parsed as unknown as T };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(timer);
    }
}
