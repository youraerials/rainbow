/**
 * photos.recent — most recently created/uploaded assets in Immich.
 *
 * Implemented via /api/search/metadata (POST) sorted by fileCreatedAt
 * descending. The smart endpoint is for CLIP queries; for "show me the
 * latest photos" we want a deterministic chronological list.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { immich } from "./client.js";

interface ImmichAsset {
    id: string;
    type: string;
    originalFileName?: string;
    fileCreatedAt?: string;
    isFavorite?: boolean;
}

interface MetadataResponse {
    assets?: { items?: ImmichAsset[] };
}

export function registerRecent(server: McpServer): void {
    server.tool(
        "photos.recent",
        "List the most recently created photos and videos in Immich.",
        {
            limit: z
                .number()
                .int()
                .positive()
                .max(200)
                .optional()
                .describe("Max results (default 50)"),
        },
        async ({ limit }) => {
            const resp = await immich<MetadataResponse>({
                method: "POST",
                path: "/api/search/metadata",
                body: {
                    order: "desc",
                    orderBy: "fileCreatedAt",
                    size: limit ?? 50,
                },
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Immich metadata search failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const items = resp.data?.assets?.items ?? [];
            const recent = items.map((a) => ({
                id: a.id,
                type: a.type,
                filename: a.originalFileName,
                taken_at: a.fileCreatedAt,
                favorite: a.isFavorite ?? false,
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
