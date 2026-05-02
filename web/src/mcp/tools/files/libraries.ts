/**
 * files.list_libraries — lists Seafile libraries (top-level "drives").
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seafile } from "./client.js";

interface SeafileLibrary {
    id: string;
    name?: string;
    permission?: string;
    encrypted?: boolean;
    size?: number;
    mtime?: number;
    owner?: string;
}

export function registerListLibraries(server: McpServer): void {
    server.tool(
        "files.list_libraries",
        "List Seafile libraries (top-level storage containers).",
        {},
        async () => {
            const resp = await seafile<SeafileLibrary[]>({ path: "/api2/repos/" });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Seafile list-libraries failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const libraries = (resp.data ?? []).map((r) => ({
                id: r.id,
                name: r.name,
                size_bytes: r.size,
                modified_at: r.mtime ? new Date(r.mtime * 1000).toISOString() : null,
                permission: r.permission,
                encrypted: r.encrypted ?? false,
                owner: r.owner,
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
