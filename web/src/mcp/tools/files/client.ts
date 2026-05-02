/**
 * Thin Seafile API client. All file tools share this — single place for
 * the base URL, auth header, and response handling.
 *
 * Seafile's REST API uses `Authorization: Token <token>` (NOT Bearer).
 * The token is provisioned by services/seafile/setup.sh after Seafile's
 * first-run init completes; the orchestrator passes it as SEAFILE_API_TOKEN.
 */

import { publicUrl } from "../../../services/registry.js";

const TOKEN = process.env.SEAFILE_API_TOKEN ?? "";

function url(path: string): string {
    return publicUrl("files", path);
}

export interface SeafileRequest {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    formBody?: URLSearchParams;
    timeoutMs?: number;
}

export interface SeafileResponse<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export async function seafile<T = unknown>(
    req: SeafileRequest,
): Promise<SeafileResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10000);
    try {
        const headers: Record<string, string> = {
            Authorization: `Token ${TOKEN}`,
            Accept: "application/json",
        };
        let body: string | URLSearchParams | undefined;
        if (req.formBody) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            body = req.formBody;
        } else if (req.body !== undefined) {
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
            // non-JSON; data stays undefined and we surface raw text on error
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
