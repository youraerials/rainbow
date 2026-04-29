/**
 * create_album tool — Create a new album in Immich.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerCreateAlbum(server: McpServer): void {
  server.tool(
    "create_album",
    "Create a new photo album in Immich",
    {
      name: z.string().describe("Album name"),
      description: z.string().optional().describe("Album description"),
      asset_ids: z
        .array(z.string())
        .optional()
        .describe("Asset IDs to add to the album"),
    },
    async ({ name, description, asset_ids }) => {
      try {
        const body: Record<string, unknown> = { albumName: name };
        if (description) {
          body.description = description;
        }
        if (asset_ids && asset_ids.length > 0) {
          body.assetIds = asset_ids;
        }

        const response = await fetch(`${IMMICH_URL}/api/albums`, {
          method: "POST",
          headers: {
            "x-api-key": API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to create album (HTTP ${response.status}): ${errorBody}`,
              },
            ],
            isError: true,
          };
        }

        const album = (await response.json()) as any;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: album.id,
                  name: album.albumName,
                  description: album.description,
                  asset_count: album.assetCount ?? 0,
                  created_at: album.createdAt,
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
              text: `Failed to create album: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
