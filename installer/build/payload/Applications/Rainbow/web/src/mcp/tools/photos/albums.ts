/**
 * photos.list_albums and photos.create_album — album catalog + creation.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { immich } from "./client.js";

interface ImmichAlbum {
    id: string;
    albumName?: string;
    description?: string;
    assetCount?: number;
    createdAt?: string;
    updatedAt?: string;
    shared?: boolean;
    albumThumbnailAssetId?: string | null;
}

export function registerListAlbums(server: McpServer): void {
    server.tool(
        "photos.list_albums",
        "List all albums in Immich with their asset counts and metadata.",
        {},
        async () => {
            const resp = await immich<ImmichAlbum[]>({
                path: "/api/albums",
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Immich list-albums failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const albums = (resp.data ?? []).map((a) => ({
                id: a.id,
                name: a.albumName,
                description: a.description,
                asset_count: a.assetCount ?? 0,
                shared: a.shared ?? false,
                created_at: a.createdAt,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ count: albums.length, albums }, null, 2),
                    },
                ],
            };
        },
    );
}

export function registerCreateAlbum(server: McpServer): void {
    server.tool(
        "photos.create_album",
        "Create a new album in Immich. Optionally seed it with asset IDs.",
        {
            name: z.string().min(1).describe("Album name"),
            description: z.string().optional().describe("Album description"),
            asset_ids: z
                .array(z.string())
                .optional()
                .describe("Asset IDs to add to the album immediately"),
        },
        async ({ name, description, asset_ids }) => {
            const body: Record<string, unknown> = { albumName: name };
            if (description) body.description = description;
            if (asset_ids?.length) body.assetIds = asset_ids;
            const resp = await immich<ImmichAlbum>({
                method: "POST",
                path: "/api/albums",
                body,
            });
            if (!resp.ok || !resp.data) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Immich create-album failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const a = resp.data;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                id: a.id,
                                name: a.albumName,
                                description: a.description,
                                asset_count: a.assetCount ?? 0,
                                created_at: a.createdAt,
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
