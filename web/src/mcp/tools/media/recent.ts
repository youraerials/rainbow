/**
 * media.recent — Jellyfin's "recently added" feed. The endpoint requires a
 * user id; we look up the configured admin's user id at call time.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jellyfin } from "./client.js";

interface JellyfinUser {
    Id: string;
    Name?: string;
    Policy?: { IsAdministrator?: boolean };
}

interface JellyfinItem {
    Id: string;
    Name?: string;
    Type?: string;
    ProductionYear?: number;
    DateCreated?: string;
    SeriesName?: string;
}

async function adminUserId(): Promise<string | null> {
    const resp = await jellyfin<JellyfinUser[]>({ path: "/Users" });
    if (!resp.ok) return null;
    const admin =
        (resp.data ?? []).find((u) => u.Policy?.IsAdministrator) ?? resp.data?.[0];
    return admin?.Id ?? null;
}

export function registerRecent(server: McpServer): void {
    server.tool(
        "media.recent",
        "List the most recently added items in Jellyfin (movies, episodes, etc.).",
        {
            limit: z
                .number()
                .int()
                .positive()
                .max(100)
                .optional()
                .describe("Max results (default 20)"),
        },
        async ({ limit }) => {
            const uid = await adminUserId();
            if (!uid) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: "Could not resolve a Jellyfin user id (admin token missing or wizard not finished?)",
                        },
                    ],
                };
            }
            const params = new URLSearchParams({
                Limit: String(limit ?? 20),
                Fields: "ProductionYear,DateCreated,SeriesName",
            });
            const resp = await jellyfin<JellyfinItem[]>({
                path: `/Users/${uid}/Items/Latest?${params.toString()}`,
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Jellyfin recent failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const recent = (resp.data ?? []).map((i) => ({
                id: i.Id,
                title: i.Name,
                type: i.Type,
                year: i.ProductionYear,
                series: i.SeriesName,
                added_at: i.DateCreated,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ count: recent.length, recent }, null, 2),
                    },
                ],
            };
        },
    );
}
