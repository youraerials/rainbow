/**
 * Service control tools — list, start, stop, restart services and view logs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const RAINBOW_CLI =
  process.env.RAINBOW_CLI ?? "/opt/rainbow/cli/rainbow";

export function registerServiceControl(server: McpServer): void {
  server.tool(
    "list_services",
    "List all Rainbow services and their current status",
    {},
    async () => {
      try {
        const { stdout } = await execAsync(`${RAINBOW_CLI} service list`, {
          timeout: 15000,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  services: stdout.trim(),
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

  server.tool(
    "start_service",
    "Start a Rainbow service",
    {
      name: z.string().describe("Service name to start"),
    },
    async ({ name }) => {
      try {
        const { stdout, stderr } = await execAsync(
          `${RAINBOW_CLI} service start ${name}`,
          { timeout: 60000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  service: name,
                  message: `Service ${name} start initiated`,
                  stdout: stdout.trim(),
                  stderr: stderr.trim() || undefined,
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

  server.tool(
    "stop_service",
    "Stop a Rainbow service",
    {
      name: z.string().describe("Service name to stop"),
    },
    async ({ name }) => {
      try {
        const { stdout, stderr } = await execAsync(
          `${RAINBOW_CLI} service stop ${name}`,
          { timeout: 60000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  service: name,
                  message: `Service ${name} stopped`,
                  stdout: stdout.trim(),
                  stderr: stderr.trim() || undefined,
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

  server.tool(
    "restart_service",
    "Restart a Rainbow service",
    {
      name: z.string().describe("Service name to restart"),
    },
    async ({ name }) => {
      try {
        const { stdout, stderr } = await execAsync(
          `${RAINBOW_CLI} service restart ${name}`,
          { timeout: 60000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  service: name,
                  message: `Service ${name} restarted`,
                  stdout: stdout.trim(),
                  stderr: stderr.trim() || undefined,
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

  server.tool(
    "service_logs",
    "View recent logs for a Rainbow service",
    {
      name: z.string().describe("Service name"),
      lines: z
        .number()
        .optional()
        .describe("Number of log lines to return (default: 50)"),
    },
    async ({ name, lines }) => {
      try {
        const lineCount = lines ?? 50;
        const { stdout } = await execAsync(
          `${RAINBOW_CLI} service logs ${name} --lines ${lineCount}`,
          { timeout: 15000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  service: name,
                  lines: lineCount,
                  logs: stdout.trim(),
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
