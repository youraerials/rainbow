/**
 * media.continue_watching — Jellyfin's "Resume" / Continue Watching list.
 * Items the user has started but hasn't finished, ordered by most-
 * recently-watched first.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jellyfin } from "./client.js";

interface JellyfinUser {
    Id: string;
    Policy?: { IsAdministrator?: boolean };
}

interface JellyfinItem {
    Id: string;
    Name?: string;
    Type?: string;
    SeriesName?: string;
    SeasonName?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    ProductionYear?: number;
    UserData?: {
        PlaybackPositionTicks?: number;
        PlayedPercentage?: number;
        LastPlayedDate?: string;
    };
    RunTimeTicks?: number;
}

async function adminUserId(): Promise<string | null> {
    const resp = await jellyfin<JellyfinUser[]>({ path: "/Users" });
    if (!resp.ok) return null;
    const admin =
        (resp.data ?? []).find((u) => u.Policy?.IsAdministrator) ?? resp.data?.[0];
    return admin?.Id ?? null;
}

export function registerContinueWatching(server: McpServer): void {
    server.tool(
        "media.continue_watching",
        "Items the user has started but not finished — Jellyfin's resume queue. Returns each item with its current playback position and remaining time.",
        {
            limit: z.number().int().positive().max(50).optional().describe("Max items (default 12)"),
        },
        async ({ limit }) => {
            const uid = await adminUserId();
            if (!uid) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: "Couldn't resolve a Jellyfin user ID — Jellyfin setup may not be complete." }],
                };
            }
            const params = new URLSearchParams({
                Limit: String(limit ?? 12),
                Recursive: "true",
                Fields: "PrimaryImageAspectRatio,UserData",
                MediaTypes: "Video",
            });
            const resp = await jellyfin<{ Items?: JellyfinItem[]; TotalRecordCount?: number }>({
                path: `/Users/${uid}/Items/Resume?${params.toString()}`,
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: `Jellyfin /Items/Resume failed: HTTP ${resp.status}` }],
                };
            }
            const items = (resp.data?.Items ?? []).map((i) => {
                // Ticks are in 10,000,000-per-second units (Win32 FILETIME).
                const positionMs = i.UserData?.PlaybackPositionTicks
                    ? Math.round(i.UserData.PlaybackPositionTicks / 10000)
                    : 0;
                const totalMs = i.RunTimeTicks ? Math.round(i.RunTimeTicks / 10000) : 0;
                const label =
                    i.Type === "Episode" && i.SeriesName
                        ? `${i.SeriesName} — ${i.SeasonName ? `${i.SeasonName} ` : ""}E${i.IndexNumber ?? "?"}: ${i.Name ?? ""}`
                        : i.Name ?? "(unknown)";
                return {
                    id: i.Id,
                    label,
                    type: i.Type,
                    series_name: i.SeriesName,
                    season_name: i.SeasonName,
                    episode: i.IndexNumber,
                    year: i.ProductionYear,
                    position_ms: positionMs,
                    total_ms: totalMs,
                    percent_played: i.UserData?.PlayedPercentage ?? 0,
                    last_played_at: i.UserData?.LastPlayedDate,
                };
            });
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                count: items.length,
                                total: resp.data?.TotalRecordCount ?? items.length,
                                items,
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
