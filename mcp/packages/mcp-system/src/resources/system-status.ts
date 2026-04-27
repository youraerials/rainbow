/**
 * System status resource — overall Rainbow system health and info.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, checkHealth, getServiceUrl } from "@rainbow/mcp-common";
import { execSync } from "node:child_process";
import { freemem, totalmem, uptime, cpus, hostname } from "node:os";

const HEALTH_ENDPOINTS: Array<{ name: string; service: string; path: string }> =
  [
    { name: "Immich", service: "immich", path: "/api/server-info/ping" },
    { name: "Stalwart", service: "stalwart", path: "/healthz" },
    { name: "Seafile", service: "seafile", path: "/api2/ping/" },
    { name: "CryptPad", service: "cryptpad", path: "/api/config" },
    { name: "Jellyfin", service: "jellyfin", path: "/health" },
    { name: "Authentik", service: "authentik", path: "/-/health/ready/" },
  ];

export function registerSystemStatusResource(server: McpServer): void {
  server.resource(
    "system-status",
    "system://status",
    {
      description: "Overall Rainbow system status including host info and service health",
      mimeType: "application/json",
    },
    async () => {
      try {
        const config = loadConfig();

        // Gather host info
        const mem = {
          total_gb: (totalmem() / 1073741824).toFixed(1),
          free_gb: (freemem() / 1073741824).toFixed(1),
          used_pct: (((totalmem() - freemem()) / totalmem()) * 100).toFixed(1),
        };

        let diskInfo = "unknown";
        try {
          diskInfo = execSync("df -h / | tail -1", {
            encoding: "utf-8",
          }).trim();
        } catch {
          // disk info unavailable
        }

        // Check service health
        const healthResults = await Promise.allSettled(
          HEALTH_ENDPOINTS.map(async ({ name, service, path }) => {
            const baseUrl = getServiceUrl(service);
            return checkHealth(name, `${baseUrl}${path}`);
          })
        );

        const services = healthResults.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : { service: "unknown", healthy: false, latency_ms: 0, checked_at: new Date().toISOString() }
        );

        const healthy = services.filter((s) => s.healthy).length;

        const status = {
          hostname: hostname(),
          domain: config.domain.primary,
          uptime_hours: (uptime() / 3600).toFixed(1),
          cpu_cores: cpus().length,
          memory: mem,
          disk: diskInfo,
          services: {
            healthy,
            total: services.length,
            details: services,
          },
          checked_at: new Date().toISOString(),
        };

        return {
          contents: [
            {
              uri: "system://status",
              mimeType: "application/json",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          contents: [
            {
              uri: "system://status",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
