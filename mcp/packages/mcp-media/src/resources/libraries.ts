/**
 * libraries resource — Jellyfin media libraries with item counts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const JELLYFIN_URL = getServiceUrl("jellyfin");
const API_TOKEN = process.env.JELLYFIN_API_TOKEN ?? "";

export function registerLibrariesResource(server: McpServer): void {
  server.resource(
    "libraries",
    "jellyfin://libraries",
    async (uri) => {
      try {
        // Get virtual folders (libraries)
        const foldersResponse = await fetch(
          `${JELLYFIN_URL}/Library/VirtualFolders`,
          {
            headers: {
              "X-Emby-Token": API_TOKEN,
              Accept: "application/json",
            },
          }
        );

        if (!foldersResponse.ok) {
          const body = await foldersResponse.text();
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  error: `Failed to list libraries (HTTP ${foldersResponse.status})`,
                  detail: body,
                }),
              },
            ],
          };
        }

        const folders = (await foldersResponse.json()) as Record<
          string,
          unknown
        >[];

        // Fetch item counts per library
        const libraries = await Promise.all(
          folders.map(async (folder) => {
            let itemCount = 0;
            const itemId = folder.ItemId as string | undefined;

            if (itemId) {
              try {
                const countResponse = await fetch(
                  `${JELLYFIN_URL}/Items?ParentId=${itemId}&Recursive=true&Limit=0`,
                  {
                    headers: {
                      "X-Emby-Token": API_TOKEN,
                      Accept: "application/json",
                    },
                  }
                );
                if (countResponse.ok) {
                  const countData = (await countResponse.json()) as any;
                  itemCount = countData.TotalRecordCount ?? 0;
                }
              } catch {
                // Count fetch failed; use 0
              }
            }

            return {
              name: folder.Name,
              collection_type: folder.CollectionType,
              item_id: itemId,
              locations: folder.Locations,
              item_count: itemCount,
            };
          })
        );

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
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
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: `Failed to fetch libraries: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
        };
      }
    }
  );
}
