/**
 * Server control tools — start, stop, restart the Minecraft server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const RAINBOW_CLI =
  process.env.RAINBOW_CLI ?? "/opt/rainbow/cli/rainbow";

async function runServiceCommand(
  action: string
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`${RAINBOW_CLI} service ${action} minecraft`);
}

export function registerServerControl(server: McpServer): void {
  server.tool(
    "start_server",
    "Start the Minecraft server",
    {},
    async () => {
      try {
        const { stdout, stderr } = await runServiceCommand("start");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: "Minecraft server start initiated",
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
    "stop_server",
    "Stop the Minecraft server",
    {},
    async () => {
      try {
        const { stdout, stderr } = await runServiceCommand("stop");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: "Minecraft server stop initiated",
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
    "restart_server",
    "Restart the Minecraft server",
    {},
    async () => {
      try {
        const { stdout, stderr } = await runServiceCommand("restart");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: "Minecraft server restart initiated",
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
}
