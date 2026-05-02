/**
 * photos.share_album — issue a public-link share for an existing album.
 *
 * Immich's shared-link API generates a key + URL. The album owner controls
 * permissions (allow upload, allow download, expiry).
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { immich } from "./client.js";

interface SharedLink {
    id: string;
    key: string;
    type: string;
    description?: string | null;
    expiresAt?: string | null;
    allowDownload?: boolean;
    allowUpload?: boolean;
    showMetadata?: boolean;
}

export function registerShareAlbum(server: McpServer): void {
    server.tool(
        "photos.share_album",
        "Generate a shared link for an existing Immich album. Returns the share URL.",
        {
            album_id: z.string().describe("Album ID to share"),
            expires_at: z
                .string()
                .optional()
                .describe("ISO 8601 expiry (e.g. 2026-12-31T23:59:59Z); omit for no expiry"),
            allow_download: z
                .boolean()
                .optional()
                .describe("Whether visitors can download originals (default true)"),
            allow_upload: z
                .boolean()
                .optional()
                .describe("Whether visitors can upload to the album (default false)"),
            description: z.string().optional().describe("Internal note for the share"),
        },
        async ({ album_id, expires_at, allow_download, allow_upload, description }) => {
            const body: Record<string, unknown> = {
                type: "ALBUM",
                albumId: album_id,
                allowDownload: allow_download ?? true,
                allowUpload: allow_upload ?? false,
                showMetadata: true,
            };
            if (expires_at) body.expiresAt = expires_at;
            if (description) body.description = description;

            const resp = await immich<SharedLink>({
                method: "POST",
                path: "/api/shared-links",
                body,
            });
            if (!resp.ok || !resp.data) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: `Immich share-album failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                        },
                    ],
                };
            }
            const host = `${process.env.RAINBOW_HOST_PREFIX ?? ""}photos.${process.env.RAINBOW_ZONE ?? ""}`;
            const shareUrl = `https://${host}/share/${resp.data.key}`;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                share_id: resp.data.id,
                                share_url: shareUrl,
                                expires_at: resp.data.expiresAt,
                                allow_download: resp.data.allowDownload,
                                allow_upload: resp.data.allowUpload,
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
