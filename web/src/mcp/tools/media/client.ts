/**
 * Thin Jellyfin API client. Uses the X-Emby-Token header for auth (Jellyfin's
 * convention). Token is provisioned by services/jellyfin/setup.sh, passed in
 * as JELLYFIN_API_KEY by the orchestrator.
 *
 * The X-Emby-Authorization header is also required on most requests — it
 * identifies the calling client even when an API token authenticates.
 */

import { publicUrl } from "../../../services/registry.js";

const TOKEN = process.env.JELLYFIN_API_KEY ?? "";
const EMBY_AUTH =
    'MediaBrowser Client="rainbow-web", Device="rainbow-web", DeviceId="rainbow-web-1", Version="0.1.0"';

function url(path: string): string {
    return publicUrl("media", path);
}

export interface JellyfinRequest {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    timeoutMs?: number;
}

export interface JellyfinResponse<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export async function jellyfin<T = unknown>(
    req: JellyfinRequest,
): Promise<JellyfinResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10000);
    try {
        const headers: Record<string, string> = {
            "X-Emby-Token": TOKEN,
            "X-Emby-Authorization": EMBY_AUTH,
            Accept: "application/json",
        };
        let body: string | undefined;
        if (req.body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(req.body);
        }
        const resp = await fetch(url(req.path), {
            method: req.method ?? "GET",
            headers,
            body,
            signal: controller.signal,
        });
        const text = await resp.text();
        let data: T | undefined;
        try {
            data = text ? (JSON.parse(text) as T) : undefined;
        } catch {
            // ignore — non-JSON; raw text in error if !ok
        }
        return {
            ok: resp.ok,
            status: resp.status,
            data,
            error: resp.ok ? undefined : (data ? undefined : text),
        };
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
