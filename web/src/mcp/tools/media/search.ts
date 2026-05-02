/**
 * media.search — search Jellyfin for movies, shows, episodes, music.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jellyfin } from "./client.js";

interface JellyfinItem {
    Id: string;
    Name?: string;
    Type?: string;
    ProductionYear?: number;
    Overview?: string;
    Genres?: string[];
    RunTimeTicks?: number;
    SeriesName?: string;
    SeasonName?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
}

interface ItemsResponse {
    Items?: JellyfinItem[];
    TotalRecordCount?: number;
}

export function registerSearchMedia(server: McpServer): void {
    server.tool(
        "media.search",
        "Search Jellyfin for movies, TV shows, episodes, music albums, and tracks.",
        {
            query: z.string().describe("Search query"),
            type: z
                .enum(["Movie", "Series", "Episode", "Audio", "MusicAlbum", "MusicArtist"])
                .optional()
                .describe("Filter by item type"),
            genre: z.string().optional().describe("Filter by genre"),
            limit: z
                .number()
                .int()
                .positive()
                .max(100)
                .optional()
                .describe("Max results (default 25)"),
        },
        async ({ query, type, genre, limit }) => {
            const params = new URLSearchParams({
                searchTerm: query,
                Recursive: "true",
                Fields: "Overview,Genres,ProductionYear,RunTimeTicks,SeriesName,SeasonName",
                Limit: String(limit ?? 25),
            });
            if (type) params.set("IncludeItemTypes", type);
            if (genre) params.set("Genres", genre);
            const resp = await jellyfin<ItemsResponse>({
                path: `/Items?${params.toString()}`,
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Jellyfin search failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const results = (resp.data?.Items ?? []).map((i) => ({
                id: i.Id,
                title: i.Name,
                type: i.Type,
                year: i.ProductionYear,
                series: i.SeriesName,
                season: i.SeasonName,
                episode: i.IndexNumber,
                runtime_minutes: i.RunTimeTicks
                    ? Math.round(i.RunTimeTicks / 600_000_000)
                    : null,
                overview: i.Overview,
                genres: i.Genres,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                query,
                                count: results.length,
                                total: resp.data?.TotalRecordCount,
                                results,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}
