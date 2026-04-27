/**
 * Player management tools — list, kick, whitelist, and op players.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendRconCommand } from "./rcon.js";

export function registerPlayerManagement(server: McpServer): void {
  server.tool(
    "list_players",
    "List all online players on the Minecraft server",
    {},
    async () => {
      try {
        const response = await sendRconCommand("list");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, response },
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
    "kick_player",
    "Kick a player from the Minecraft server",
    {
      name: z.string().describe("Player name to kick"),
      reason: z.string().optional().describe("Reason for kicking the player"),
    },
    async ({ name, reason }) => {
      try {
        const cmd = reason ? `kick ${name} ${reason}` : `kick ${name}`;
        const response = await sendRconCommand(cmd);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  player: name,
                  reason: reason ?? null,
                  response,
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
    "whitelist_add",
    "Add a player to the server whitelist",
    {
      name: z.string().describe("Player name to add to whitelist"),
    },
    async ({ name }) => {
      try {
        const response = await sendRconCommand(`whitelist add ${name}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, player: name, response },
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
    "whitelist_remove",
    "Remove a player from the server whitelist",
    {
      name: z.string().describe("Player name to remove from whitelist"),
    },
    async ({ name }) => {
      try {
        const response = await sendRconCommand(`whitelist remove ${name}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, player: name, response },
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
    "op_player",
    "Grant operator privileges to a player",
    {
      name: z.string().describe("Player name to grant operator status"),
    },
    async ({ name }) => {
      try {
        const response = await sendRconCommand(`op ${name}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, player: name, response },
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
