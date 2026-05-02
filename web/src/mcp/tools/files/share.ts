/**
 * files.share — generate a shared download link for a file in Seafile.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seafile } from "./client.js";

interface SharedLink {
    token?: string;
    link?: string;
    expire_date?: string;
}

export function registerShareFile(server: McpServer): void {
    server.tool(
        "files.share",
        "Create a public shared link for a file or folder in Seafile.",
        {
            library_id: z.string().describe("Library ID containing the file"),
            path: z.string().describe("Path inside the library (e.g. /docs/notes.md)"),
            password: z
                .string()
                .optional()
                .describe("Optional password to protect the link"),
            expire_days: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Days until link expires; omit for no expiry"),
        },
        async ({ library_id, path, password, expire_days }) => {
            const body = new URLSearchParams({
                repo_id: library_id,
                path,
            });
            if (password) body.set("password", password);
            if (expire_days) body.set("expire_days", String(expire_days));
            const resp = await seafile<SharedLink>({
                method: "POST",
                path: "/api/v2.1/share-links/",
                formBody: body,
            });
            if (!resp.ok || !resp.data) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Seafile share failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                share_url: resp.data.link,
                                token: resp.data.token,
                                expires_at: resp.data.expire_date,
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
