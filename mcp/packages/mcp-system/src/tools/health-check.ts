/**
 * health_check tool — checks health of all Rainbow services.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkHealth, getServiceUrl } from "@rainbow/mcp-common";

/** Services and their health check endpoints. */
const HEALTH_ENDPOINTS: Array<{ name: string; service: string; path: string }> =
  [
    { name: "Immich (Photos)", service: "immich", path: "/api/server-info/ping" },
    { name: "Stalwart (Email)", service: "stalwart", path: "/healthz" },
    { name: "Seafile (Files)", service: "seafile", path: "/api2/ping/" },
    { name: "CryptPad (Docs)", service: "cryptpad", path: "/api/config" },
    { name: "Jellyfin (Media)", service: "jellyfin", path: "/health" },
    { name: "Authentik (Auth)", service: "authentik", path: "/-/health/ready/" },
  ];

export function registerHealthCheck(server: McpServer): void {
  server.tool(
    "health_check",
    "Check the health of all Rainbow services",
    {},
    async () => {
      try {
        const results = await Promise.all(
          HEALTH_ENDPOINTS.map(async ({ name, service, path }) => {
            const baseUrl = getServiceUrl(service);
            return checkHealth(name, `${baseUrl}${path}`);
          })
        );

        const healthy = results.filter((r) => r.healthy).length;
        const total = results.length;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  summary: `${healthy}/${total} services healthy`,
                  services: results,
                  checked_at: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
