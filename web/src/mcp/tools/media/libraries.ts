/**
 * media.list_libraries — Jellyfin's media folders (collections like
 * Movies, TV, Music). Useful catalog for AI agents to know what's there.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jellyfin } from "./client.js";

interface MediaFolder {
    Id: string;
    Name?: string;
    CollectionType?: string;
    LibraryOptions?: { ContentType?: string };
    Path?: string;
}

interface MediaFoldersResponse {
    Items?: MediaFolder[];
}

export function registerListLibraries(server: McpServer): void {
    server.tool(
        "media.list_libraries",
        "List Jellyfin media libraries (Movies, TV Shows, Music, etc.) with their content types.",
        {},
        async () => {
            const resp = await jellyfin<MediaFoldersResponse>({
                path: "/Library/MediaFolders",
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Jellyfin list-libraries failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const libraries = (resp.data?.Items ?? []).map((f) => ({
                id: f.Id,
                name: f.Name,
                type: f.CollectionType,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            { count: libraries.length, libraries },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}
