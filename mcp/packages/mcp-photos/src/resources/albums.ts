/**
 * albums resource — List all Immich albums with counts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerAlbumsResource(server: McpServer): void {
  server.resource("albums", "immich://albums", async (uri) => {
    try {
      const response = await fetch(`${IMMICH_URL}/api/albums`, {
        headers: {
          "x-api-key": API_KEY,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: `Failed to list albums (HTTP ${response.status})`,
                detail: body,
              }),
            },
          ],
        };
      }

      const albums = await response.json();

      const result = (albums as Record<string, unknown>[]).map((album) => ({
        id: album.id,
        name: album.albumName,
        description: album.description,
        asset_count: album.assetCount,
        created_at: album.createdAt,
        updated_at: album.updatedAt,
        shared: album.shared,
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ count: result.length, albums: result }, null, 2),
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
              error: `Failed to fetch albums: ${error instanceof Error ? error.message : String(error)}`,
            }),
          },
        ],
      };
    }
  });
}
