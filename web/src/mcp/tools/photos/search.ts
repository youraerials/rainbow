/**
 * photos.search — Immich's CLIP-based smart search. Natural language
 * query, optional date range and asset type filters.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { immich } from "./client.js";

interface ImmichAsset {
    id: string;
    type: string;
    originalFileName?: string;
    fileCreatedAt?: string;
    exifInfo?: { description?: string };
}

interface SmartSearchResponse {
    assets?: { total?: number; count?: number; items?: ImmichAsset[] };
}

export function registerSearchPhotos(server: McpServer): void {
    server.tool(
        "photos.search",
        "Search photos and videos in Immich using CLIP smart search. Returns matching assets with id, filename, taken_at, and description.",
        {
            query: z.string().describe("Natural language search query"),
            type: z
                .enum(["IMAGE", "VIDEO", "ALL"])
                .optional()
                .describe("Filter by asset type"),
            date_from: z
                .string()
                .optional()
                .describe("Earliest date (ISO 8601, e.g. 2024-01-01)"),
            date_to: z
                .string()
                .optional()
                .describe("Latest date (ISO 8601, e.g. 2024-12-31)"),
            limit: z
                .number()
                .int()
                .positive()
                .max(200)
                .optional()
                .describe("Max results (default 50)"),
        },
        async ({ query, type, date_from, date_to, limit }) => {
            // Immich 2.x: smart search is POST /api/search/smart with JSON body.
            const body: Record<string, unknown> = { query };
            if (type && type !== "ALL") body.type = type;
            if (date_from) body.takenAfter = date_from;
            if (date_to) body.takenBefore = date_to;
            if (limit) body.size = limit;

            const resp = await immich<SmartSearchResponse>({
                method: "POST",
                path: "/api/search/smart",
                body,
                timeoutMs: 30000, // CLIP search can take a few seconds on first call
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Immich search failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }

            const items = resp.data?.assets?.items ?? [];
            const results = items.map((a) => ({
                id: a.id,
                type: a.type,
                filename: a.originalFileName,
                taken_at: a.fileCreatedAt,
                description: a.exifInfo?.description ?? null,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            { query, count: results.length, results },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}
