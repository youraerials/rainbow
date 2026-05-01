/**
 * system.list_services — returns the static catalog of Rainbow services
 * with their public URLs. Sufficient for an AI client to know "which apps
 * are available" and how to reach them; per-service tools (mcp-photos etc.)
 * land in Phase 3.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVICES, publicHost, publicUrl } from "./hosts.js";

export function registerListServices(server: McpServer): void {
    server.tool(
        "system.list_services",
        "List all Rainbow services with their public URLs and roles.",
        {},
        async () => {
            const services = SERVICES.map((s) => ({
                slug: s.slug,
                name: s.name,
                hostname: publicHost(s.slug),
                url: publicUrl(s.slug),
            }));
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify({ services }, null, 2) },
                ],
            };
        },
    );
}
