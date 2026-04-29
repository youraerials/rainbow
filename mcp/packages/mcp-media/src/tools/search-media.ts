/**
 * search_media tool — Search for media items in Jellyfin.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const JELLYFIN_URL = getServiceUrl("jellyfin");
const API_TOKEN = process.env.JELLYFIN_API_TOKEN ?? "";

export function registerSearchMedia(server: McpServer): void {
  server.tool(
    "search_media",
    "Search for movies, TV shows, music, and other media in Jellyfin",
    {
      query: z.string().describe("Search query"),
      type: z
        .enum(["Movie", "Series", "Episode", "Audio", "MusicAlbum", "MusicArtist"])
        .optional()
        .describe("Filter by media type"),
      genre: z.string().optional().describe("Filter by genre name"),
    },
    async ({ query, type, genre }) => {
      try {
        const params = new URLSearchParams({
          searchTerm: query,
          Recursive: "true",
          Fields: "Overview,Genres,MediaSources,RunTimeTicks",
          Limit: "25",
        });

        if (type) {
          params.set("IncludeItemTypes", type);
        }
        if (genre) {
          params.set("Genres", genre);
        }

        const response = await fetch(
          `${JELLYFIN_URL}/Items?${params.toString()}`,
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
                text: `Jellyfin search failed (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as any;
        const items = (data.Items ?? []) as Record<string, unknown>[];

        const results = items.map((item) => ({
          id: item.Id,
          name: item.Name,
          type: item.Type,
          year: item.ProductionYear,
          overview: item.Overview
            ? String(item.Overview).slice(0, 200)
            : null,
          genres: item.Genres,
          runtime_minutes: item.RunTimeTicks
            ? Math.round((item.RunTimeTicks as number) / 600000000)
            : null,
          community_rating: item.CommunityRating,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  total: data.TotalRecordCount ?? results.length,
                  count: results.length,
                  results,
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
              text: `Failed to search media: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
