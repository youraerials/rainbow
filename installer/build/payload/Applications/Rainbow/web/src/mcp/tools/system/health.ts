/**
 * system.health_check — pings every Rainbow service and returns latency +
 * status per service. Useful as a top-level "is everything OK?" check.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkAll } from "../../../services/health.js";

export function registerHealthCheck(server: McpServer): void {
    server.tool(
        "system.health_check",
        "Check the reachability and latency of every Rainbow service via its public URL.",
        {},
        async () => {
            const results = await checkAll();
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
