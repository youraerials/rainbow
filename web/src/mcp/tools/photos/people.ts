/**
 * photos.list_people     — enumerate Immich's recognized faces / people.
 * photos.search_by_face  — find photos containing one or more known people.
 * photos.add_to_album    — add asset IDs to an existing album.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { immich } from "./client.js";

interface ImmichPerson {
    id: string;
    name?: string;
    birthDate?: string | null;
    thumbnailPath?: string;
    isHidden?: boolean;
}

interface ImmichPeopleResp {
    people?: ImmichPerson[];
    total?: number;
}

interface ImmichSearchResp {
    assets?: { items?: Array<{ id: string; type?: string; originalFileName?: string; localDateTime?: string }>; total?: number };
}

export function registerListPeople(server: McpServer): void {
    server.tool(
        "photos.list_people",
        "List people recognized in the user's photo library (Immich face recognition). Includes both named and unnamed people.",
        {
            named_only: z.boolean().optional().describe("Hide entries Immich hasn't been told the name of"),
            limit: z.number().int().positive().max(500).optional().describe("Max people (default 100)"),
        },
        async ({ named_only, limit }) => {
            const resp = await immich<ImmichPeopleResp>({ path: "/api/people" });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: `Immich /api/people failed: HTTP ${resp.status}` }],
                };
            }
            let people = (resp.data?.people ?? []).filter((p) => !p.isHidden);
            if (named_only) people = people.filter((p) => (p.name ?? "").trim() !== "");
            const cap = limit ?? 100;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                count: Math.min(people.length, cap),
                                total: people.length,
                                people: people.slice(0, cap).map((p) => ({
                                    id: p.id,
                                    name: p.name && p.name.trim() ? p.name : null,
                                    birth_date: p.birthDate ?? null,
                                })),
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

export function registerSearchByFace(server: McpServer): void {
    server.tool(
        "photos.search_by_face",
        "Find photos that contain one or more specific people (matched by Immich person id from photos.list_people).",
        {
            person_ids: z
                .array(z.string())
                .min(1)
                .describe("One or more Immich person IDs to match"),
            limit: z.number().int().positive().max(200).optional().describe("Max assets (default 50)"),
        },
        async ({ person_ids, limit }) => {
            // Immich's smart-search endpoint accepts a `personIds` array.
            const resp = await immich<ImmichSearchResp>({
                method: "POST",
                path: "/api/search/metadata",
                body: {
                    personIds: person_ids,
                    size: limit ?? 50,
                    page: 1,
                },
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: `Immich face search failed: HTTP ${resp.status}` }],
                };
            }
            const items = resp.data?.assets?.items ?? [];
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                count: items.length,
                                total: resp.data?.assets?.total ?? items.length,
                                people_queried: person_ids,
                                results: items.map((a) => ({
                                    asset_id: a.id,
                                    type: a.type,
                                    filename: a.originalFileName,
                                    taken_at: a.localDateTime,
                                })),
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

export function registerAddToAlbum(server: McpServer): void {
    server.tool(
        "photos.add_to_album",
        "Add one or more photos to an existing album.",
        {
            album_id: z.string().describe("Album ID from photos.list_albums or photos.create_album"),
            asset_ids: z
                .array(z.string())
                .min(1)
                .describe("Immich asset IDs to add"),
        },
        async ({ album_id, asset_ids }) => {
            const resp = await immich<Array<{ id: string; success?: boolean; error?: string }>>({
                method: "PUT",
                path: `/api/albums/${encodeURIComponent(album_id)}/assets`,
                body: { ids: asset_ids },
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: `Immich add-to-album failed: HTTP ${resp.status}` }],
                };
            }
            const results = resp.data ?? [];
            const added = results.filter((r) => r.success !== false).length;
            const skipped = results.length - added;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                album_id,
                                added,
                                skipped,
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
