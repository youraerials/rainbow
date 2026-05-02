/**
 * files.list — list contents of a path inside a Seafile library.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seafile } from "./client.js";

interface SeafileEntry {
    type: "file" | "dir";
    name: string;
    id?: string;
    mtime?: number;
    size?: number;
    permission?: string;
}

export function registerListFiles(server: McpServer): void {
    server.tool(
        "files.list",
        "List files and folders inside a Seafile library at the given path.",
        {
            library_id: z.string().describe("Library ID (from files.list_libraries)"),
            path: z
                .string()
                .optional()
                .describe('Folder path (default "/"); use forward slashes'),
        },
        async ({ library_id, path }) => {
            const params = new URLSearchParams({ p: path ?? "/" });
            const resp = await seafile<SeafileEntry[]>({
                path: `/api2/repos/${library_id}/dir/?${params.toString()}`,
            });
            if (!resp.ok) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Seafile list failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const entries = (resp.data ?? []).map((e) => ({
                type: e.type,
                name: e.name,
                size_bytes: e.size,
                modified_at: e.mtime ? new Date(e.mtime * 1000).toISOString() : null,
            }));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                library_id,
                                path: path ?? "/",
                                count: entries.length,
                                entries,
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
