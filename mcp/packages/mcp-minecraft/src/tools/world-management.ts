/**
 * World management tools — weather, time, difficulty, gamemode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendRconCommand } from "./rcon.js";

export function registerWorldManagement(server: McpServer): void {
  server.tool(
    "set_weather",
    "Set the weather in the Minecraft world",
    {
      type: z
        .enum(["clear", "rain", "thunder"])
        .describe("Weather type to set"),
    },
    async ({ type }) => {
      try {
        const response = await sendRconCommand(`weather ${type}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, weather: type, response },
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
    "set_time",
    "Set the time in the Minecraft world",
    {
      time: z
        .string()
        .describe(
          "Time value: 'day', 'night', 'noon', 'midnight', or a tick number (0-24000)"
        ),
    },
    async ({ time }) => {
      try {
        const response = await sendRconCommand(`time set ${time}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, time, response },
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
    "set_difficulty",
    "Set the server difficulty",
    {
      level: z
        .enum(["peaceful", "easy", "normal", "hard"])
        .describe("Difficulty level"),
    },
    async ({ level }) => {
      try {
        const response = await sendRconCommand(`difficulty ${level}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, difficulty: level, response },
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
    "set_gamemode",
    "Set a player's game mode",
    {
      player: z.string().describe("Player name"),
      mode: z
        .enum(["survival", "creative", "adventure", "spectator"])
        .describe("Game mode to set"),
    },
    async ({ player, mode }) => {
      try {
        const response = await sendRconCommand(`gamemode ${mode} ${player}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, player, mode, response },
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
