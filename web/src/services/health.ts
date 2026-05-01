/**
 * Health checks across every Rainbow service. Hits each one's public URL via
 * Cloudflare → tunnel → Caddy → the service. Same path the user's browser
 * takes; reachability here means reachability for users.
 */

import { SERVICES, publicUrl, ServiceDescriptor } from "./registry.js";

export interface ServiceHealth {
    name: string;
    slug: string;
    displayName: string;
    url: string;
    healthy: boolean;
    status?: number;
    latencyMs: number;
    error?: string;
}

async function checkOne(s: ServiceDescriptor): Promise<ServiceHealth> {
    const url = publicUrl(s.slug, s.healthPath);
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const resp = await fetch(url, { method: "GET", signal: controller.signal });
        return {
            name: s.name,
            slug: s.slug,
            displayName: s.displayName,
            url,
            healthy: resp.ok,
            status: resp.status,
            latencyMs: Date.now() - start,
        };
    } catch (err) {
        return {
            name: s.name,
            slug: s.slug,
            displayName: s.displayName,
            url,
            healthy: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function checkAll(): Promise<ServiceHealth[]> {
    return Promise.all(SERVICES.map(checkOne));
}
