/**
 * Backup tools — start, list, and restore backups via backup.sh.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const BACKUP_SCRIPT =
  process.env.BACKUP_SCRIPT ?? "/opt/rainbow/scripts/backup.sh";

export function registerBackup(server: McpServer): void {
  server.tool(
    "start_backup",
    "Start a backup of all Rainbow services and data",
    {},
    async () => {
      try {
        const { stdout, stderr } = await execAsync(
          `${BACKUP_SCRIPT} run`,
          { timeout: 300000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: "Backup started",
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
    "list_backups",
    "List available backup snapshots",
    {},
    async () => {
      try {
        const { stdout } = await execAsync(`${BACKUP_SCRIPT} list`, {
          timeout: 30000,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  backups: stdout.trim(),
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
    "restore_backup",
    "Restore from a specific backup snapshot",
    {
      snapshot_id: z
        .string()
        .describe("The snapshot ID to restore from"),
    },
    async ({ snapshot_id }) => {
      try {
        const { stdout, stderr } = await execAsync(
          `${BACKUP_SCRIPT} restore ${snapshot_id}`,
          { timeout: 600000 }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Restore from snapshot ${snapshot_id} initiated`,
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
