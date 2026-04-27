/**
 * Service list resource — all Rainbow services and their status.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const RAINBOW_CLI =
  process.env.RAINBOW_CLI ?? "/opt/rainbow/cli/rainbow";

export function registerServiceListResource(server: McpServer): void {
  server.resource(
    "service-list",
    "system://services",
    {
      description: "All Rainbow services and their current running status",
      mimeType: "application/json",
    },
    async () => {
      try {
        const { stdout } = await execAsync(`${RAINBOW_CLI} service list --json`, {
          timeout: 15000,
        });

        let services: unknown;
        try {
          services = JSON.parse(stdout);
        } catch {
          // CLI may not support JSON output; return raw text
          services = { raw: stdout.trim() };
        }

        return {
          contents: [
            {
              uri: "system://services",
              mimeType: "application/json",
              text: JSON.stringify(services, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          contents: [
            {
              uri: "system://services",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
