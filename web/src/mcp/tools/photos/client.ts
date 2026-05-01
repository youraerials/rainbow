/**
 * Thin Immich API client. All photo tools share this — single place for
 * the base URL, API key header, and JSON-vs-text response handling.
 */

import { publicUrl } from "../../../services/registry.js";

const API_KEY = process.env.IMMICH_API_KEY ?? "";

function url(path: string): string {
    return publicUrl("photos", path);
}

export interface ImmichRequest {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    timeoutMs?: number;
}

export interface ImmichResponse<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export async function immich<T = unknown>(
    req: ImmichRequest,
): Promise<ImmichResponse<T>> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), req.timeoutMs ?? 10000);
    try {
        const resp = await fetch(url(req.path), {
            method: req.method ?? "GET",
            headers: {
                "x-api-key": API_KEY,
                Accept: "application/json",
                ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
            },
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
            signal: controller.signal,
        });
        const text = await resp.text();
        let data: T | undefined;
        try {
            data = text ? (JSON.parse(text) as T) : undefined;
        } catch {
            // Non-JSON response; leave data undefined and put text in error.
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
        clearTimeout(t);
    }
}
