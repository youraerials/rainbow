/**
 * Server status resource — exposes Minecraft server status, online players, and TPS.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendRconCommand } from "../tools/rcon.js";

export function registerServerStatusResource(server: McpServer): void {
  server.resource(
    "server-status",
    "minecraft://status",
    {
      description:
        "Minecraft server status including online players and TPS",
      mimeType: "application/json",
    },
    async () => {
      try {
        // Gather status info via RCON
        const [listResponse, tpsResponse] = await Promise.allSettled([
          sendRconCommand("list"),
          sendRconCommand("tps"),
        ]);

        const playerList =
          listResponse.status === "fulfilled"
            ? listResponse.value
            : "Unable to fetch player list";
        const tps =
          tpsResponse.status === "fulfilled"
            ? tpsResponse.value
            : "Unable to fetch TPS";

        // Parse player count from "list" response
        // Typical format: "There are X of a max of Y players online: player1, player2"
        let onlineCount = 0;
        let maxPlayers = 0;
        let players: string[] = [];

        const listMatch = playerList.match(
          /There are (\d+) of a max of (\d+) players online:\s*(.*)/
        );
        if (listMatch) {
          onlineCount = parseInt(listMatch[1], 10);
          maxPlayers = parseInt(listMatch[2], 10);
          players = listMatch[3]
            ? listMatch[3]
                .split(",")
                .map((p: string) => p.trim())
                .filter(Boolean)
            : [];
        }

        const status = {
          online: true,
          players: {
            online: onlineCount,
            max: maxPlayers,
            list: players,
          },
          tps: tps,
          raw: {
            list: playerList,
            tps: tps,
          },
          checked_at: new Date().toISOString(),
        };

        return {
          contents: [
            {
              uri: "minecraft://status",
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
              uri: "minecraft://status",
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  online: false,
                  error: message,
                  checked_at: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
