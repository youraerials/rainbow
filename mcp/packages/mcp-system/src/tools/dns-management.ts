/**
 * DNS management tools — list and create DNS records via Cloudflare worker API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "@rainbow/mcp-common";

const CLOUDFLARE_WORKER_URL =
  process.env.CLOUDFLARE_WORKER_URL ??
  "https://subdomain-manager.rainbow.workers.dev";

function getApiToken(): string {
  return process.env.CLOUDFLARE_API_TOKEN ?? "";
}

export function registerDnsManagement(server: McpServer): void {
  server.tool(
    "list_dns_records",
    "List all DNS records for the Rainbow domain",
    {},
    async () => {
      try {
        const config = loadConfig();
        const response = await fetch(
          `${CLOUDFLARE_WORKER_URL}/records?domain=${config.domain.primary}`,
          {
            headers: {
              Authorization: `Bearer ${getApiToken()}`,
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Cloudflare worker error (HTTP ${response.status}): ${text}`
          );
        }

        const records = await response.json();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, records },
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

  server.tool(
    "create_dns_record",
    "Create a new DNS record for a Rainbow subdomain",
    {
      type: z
        .enum(["A", "AAAA", "CNAME", "TXT", "MX", "SRV"])
        .describe("DNS record type"),
      name: z
        .string()
        .describe("Subdomain name (e.g., 'app' for app.yourdomain.com)"),
      content: z
        .string()
        .describe("Record content (IP address, hostname, or text value)"),
    },
    async ({ type, name, content }) => {
      try {
        const config = loadConfig();
        const response = await fetch(`${CLOUDFLARE_WORKER_URL}/records`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getApiToken()}`,
          },
          body: JSON.stringify({
            type,
            name: `${name}.${config.domain.primary}`,
            content,
            proxied: type === "A" || type === "AAAA" || type === "CNAME",
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Cloudflare worker error (HTTP ${response.status}): ${text}`
          );
        }

        const result = await response.json();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `DNS record created: ${type} ${name}.${config.domain.primary} -> ${content}`,
                  record: result,
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
