/**
 * search_photos tool — Smart search for photos and videos via Immich CLIP search.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerSearchPhotos(server: McpServer): void {
  server.tool(
    "search_photos",
    "Search photos and videos using smart (CLIP-based) search in Immich",
    {
      query: z.string().describe("Natural language search query"),
      type: z
        .enum(["IMAGE", "VIDEO", "ALL"])
        .optional()
        .describe("Filter by asset type"),
      date_from: z
        .string()
        .optional()
        .describe("Start date filter (ISO 8601, e.g. 2024-01-01)"),
      date_to: z
        .string()
        .optional()
        .describe("End date filter (ISO 8601, e.g. 2024-12-31)"),
    },
    async ({ query, type, date_from, date_to }) => {
      try {
        const params = new URLSearchParams({ query });
        if (type && type !== "ALL") {
          params.set("type", type);
        }
        if (date_from) {
          params.set("takenAfter", date_from);
        }
        if (date_to) {
          params.set("takenBefore", date_to);
        }

        const response = await fetch(
          `${IMMICH_URL}/api/search/smart?${params.toString()}`,
          {
            method: "GET",
            headers: {
              "x-api-key": API_KEY,
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
                text: `Immich search failed (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as any;
        const assets = data.assets?.items ?? data.items ?? [];

        const results = assets.map((asset: Record<string, unknown>) => ({
          id: asset.id,
          type: asset.type,
          filename: asset.originalFileName,
          taken_at: asset.fileCreatedAt,
          description: asset.exifInfo
            ? (asset.exifInfo as Record<string, unknown>).description
            : null,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { count: results.length, results },
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
              text: `Failed to search photos: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
