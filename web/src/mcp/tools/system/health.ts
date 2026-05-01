/**
 * system.health_check — pings every Rainbow service and returns latency +
 * status per service. Useful as a top-level "is everything OK?" check.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVICES, publicUrl } from "./hosts.js";

interface ServiceHealth {
    name: string;
    slug: string;
    url: string;
    healthy: boolean;
    status?: number;
    latencyMs: number;
    error?: string;
}

async function checkOne(
    name: string,
    slug: string,
    healthPath: string,
): Promise<ServiceHealth> {
    const url = publicUrl(slug, healthPath);
    const start = Date.now();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
        const resp = await fetch(url, { method: "GET", signal: controller.signal });
        return {
            name,
            slug,
            url,
            healthy: resp.ok,
            status: resp.status,
            latencyMs: Date.now() - start,
        };
    } catch (err) {
        return {
            name,
            slug,
            url,
            healthy: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(t);
    }
}

export function registerHealthCheck(server: McpServer): void {
    server.tool(
        "system.health_check",
        "Check the reachability and latency of every Rainbow service via its public URL.",
        {},
        async () => {
            const results = await Promise.all(
                SERVICES.map((s) => checkOne(s.name, s.slug, s.healthPath)),
            );
            const summary = {
                checked: results.length,
                healthy: results.filter((r) => r.healthy).length,
                unhealthy: results.filter((r) => !r.healthy).map((r) => r.slug),
                services: results,
                timestamp: new Date().toISOString(),
            };
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify(summary, null, 2) },
                ],
            };
        },
    );
}
