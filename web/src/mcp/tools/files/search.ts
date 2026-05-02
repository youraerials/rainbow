/**
 * files.search — full-text + filename search across all Seafile libraries
 * the user can access.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seafile } from "./client.js";

interface SearchResult {
    repo_id: string;
    repo_name?: string;
    fullpath?: string;
    name?: string;
    size?: number;
    last_modified?: string;
    is_dir?: boolean;
    content_highlight?: string;
}

interface SearchResponse {
    total?: number;
    results?: SearchResult[];
    has_more?: boolean;
}

export function registerSearchFiles(server: McpServer): void {
    server.tool(
        "files.search",
        "Search Seafile by filename and (when full-text indexing is enabled) file contents.",
        {
            query: z.string().describe("Search query"),
            library_id: z
                .string()
                .optional()
                .describe("Restrict to a specific library; omit to search all"),
            limit: z
                .number()
                .int()
                .positive()
                .max(100)
                .optional()
                .describe("Max results (default 20)"),
        },
        async ({ query, library_id, limit }) => {
            const params = new URLSearchParams({
                q: query,
                per_page: String(limit ?? 20),
            });
            if (library_id) params.set("search_repo", library_id);
            const resp = await seafile<SearchResponse>({
                path: `/api2/search/?${params.toString()}`,
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Seafile search failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const hits = (resp.data?.results ?? []).map((r) => ({
                library_id: r.repo_id,
                library_name: r.repo_name,
                path: r.fullpath,
                name: r.name,
                size_bytes: r.size,
                modified_at: r.last_modified,
                is_directory: r.is_dir ?? false,
                preview: r.content_highlight,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                query,
                                count: hits.length,
                                total: resp.data?.total,
                                results: hits,
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
