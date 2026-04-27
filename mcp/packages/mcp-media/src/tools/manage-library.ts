/**
 * Library management tools — list and refresh Jellyfin libraries.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const JELLYFIN_URL = getServiceUrl("jellyfin");
const API_TOKEN = process.env.JELLYFIN_API_TOKEN ?? "";

export function registerManageLibrary(server: McpServer): void {
  server.tool(
    "list_libraries",
    "List all Jellyfin media libraries",
    {},
    async () => {
      try {
        const response = await fetch(
          `${JELLYFIN_URL}/Library/VirtualFolders`,
          {
            headers: {
              "X-Emby-Token": API_TOKEN,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to list libraries (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const folders = (await response.json()) as Record<string, unknown>[];

        const libraries = folders.map((folder) => ({
          name: folder.Name,
          collection_type: folder.CollectionType,
          item_id: folder.ItemId,
          locations: folder.Locations,
          refresh_status: folder.RefreshStatus,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { count: libraries.length, libraries },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to list libraries: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "refresh_library",
    "Trigger a library scan/refresh in Jellyfin",
    {
      library_id: z
        .string()
        .optional()
        .describe(
          "Library item ID to refresh. If omitted, refreshes all libraries."
        ),
    },
    async ({ library_id }) => {
      try {
        const url = library_id
          ? `${JELLYFIN_URL}/Items/${library_id}/Refresh`
          : `${JELLYFIN_URL}/Library/Refresh`;

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "X-Emby-Token": API_TOKEN,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to refresh library (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "refresh_started",
                  library_id: library_id ?? "all",
                  message: library_id
                    ? `Library ${library_id} refresh initiated`
                    : "Full library refresh initiated",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to refresh library: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
