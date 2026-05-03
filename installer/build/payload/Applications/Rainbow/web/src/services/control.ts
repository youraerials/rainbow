/**
 * Client for the host-side control daemon (services/control/server.js).
 *
 * The web tier runs in an Apple Container; it can't call the `container` CLI
 * directly. The control daemon runs on the macOS host as a launchd service and
 * exposes a small HTTP API. We reach it at host.docker.internal:9001 and
 * authenticate with a shared bearer token (also held in macOS Keychain).
 *
 * URL + token come from env: RAINBOW_CONTROL_URL, RAINBOW_CONTROL_TOKEN.
 * If either is missing isConfigured() returns false and the caller can 503.
 */

const CONTROL_URL = (process.env.RAINBOW_CONTROL_URL ?? "").replace(/\/+$/, "");
const CONTROL_TOKEN = process.env.RAINBOW_CONTROL_TOKEN ?? "";

export function isConfigured(): boolean {
    return Boolean(CONTROL_URL && CONTROL_TOKEN);
}

export interface ContainerActionResult {
    container: string;
    ok: boolean;
    status: number;
    body: unknown;
}

async function call(
    method: "GET" | "POST",
    path: string,
): Promise<{ status: number; body: unknown }> {
    if (!isConfigured()) {
        return {
            status: 503,
            body: { error: "control daemon not configured" },
        };
    }
    const url = `${CONTROL_URL}${path}`;
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
    });
    let body: unknown = null;
    const text = await res.text();
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = { raw: text };
    }
    return { status: res.status, body };
}

export async function restart(name: string): Promise<ContainerActionResult> {
    const { status, body } = await call("POST", `/restart/${encodeURIComponent(name)}`);
    return { container: name, ok: status >= 200 && status < 300, status, body };
}

export async function start(name: string): Promise<ContainerActionResult> {
    const { status, body } = await call("POST", `/start/${encodeURIComponent(name)}`);
    return { container: name, ok: status >= 200 && status < 300, status, body };
}

export async function stop(name: string): Promise<ContainerActionResult> {
    const { status, body } = await call("POST", `/stop/${encodeURIComponent(name)}`);
    return { container: name, ok: status >= 200 && status < 300, status, body };
}

export async function logs(
    name: string,
    lines: number,
): Promise<{ status: number; body: unknown }> {
    return call("GET", `/logs/${encodeURIComponent(name)}?lines=${lines}`);
}
