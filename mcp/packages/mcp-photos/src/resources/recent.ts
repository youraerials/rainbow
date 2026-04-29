/**
 * recent resource — Recent photos and videos from Immich.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerRecentResource(server: McpServer): void {
  server.resource(
    "recent-photos",
    "immich://recent",
    async (uri) => {
      try {
        // Use the search/metadata endpoint to get recent assets sorted by date
        const response = await fetch(`${IMMICH_URL}/api/search/metadata`, {
          method: "POST",
          headers: {
            "x-api-key": API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            order: "desc",
            orderBy: "fileCreatedAt",
            size: 50,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  error: `Failed to fetch recent assets (HTTP ${response.status})`,
                  detail: body,
                }),
              },
            ],
          };
        }

        const data = (await response.json()) as any;
        const assets = data.assets?.items ?? data.items ?? [];

        const result = (assets as Record<string, unknown>[]).map((asset) => ({
          id: asset.id,
          type: asset.type,
          filename: asset.originalFileName,
          taken_at: asset.fileCreatedAt,
          is_favorite: asset.isFavorite,
        }));

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                { count: result.length, recent: result },
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
                error: `Failed to fetch recent photos: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
        };
      }
    }
  );
}
