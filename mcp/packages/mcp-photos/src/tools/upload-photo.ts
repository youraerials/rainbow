/**
 * upload_photo tool — Upload a photo or video to Immich.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerUploadPhoto(server: McpServer): void {
  server.tool(
    "upload_photo",
    "Upload a photo or video to Immich",
    {
      filename: z.string().describe("Original filename (e.g. photo.jpg)"),
      content_base64: z
        .string()
        .describe("Base64-encoded file content"),
      album_id: z
        .string()
        .optional()
        .describe("Album ID to add the uploaded asset to"),
    },
    async ({ filename, content_base64, album_id }) => {
      try {
        const fileBuffer = Buffer.from(content_base64, "base64");

        // Immich expects multipart/form-data for asset upload
        const boundary = `----RainbowUpload${Date.now()}`;
        const deviceAssetId = `rainbow-${Date.now()}-${filename}`;
        const now = new Date().toISOString();

        const parts: Buffer[] = [];

        // Add metadata fields
        const fields: Record<string, string> = {
          deviceAssetId,
          deviceId: "rainbow-mcp",
          fileCreatedAt: now,
          fileModifiedAt: now,
          isFavorite: "false",
        };

        for (const [key, value] of Object.entries(fields)) {
          parts.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
            )
          );
        }

        // Add file
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
          )
        );
        parts.push(fileBuffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const bodyBuffer = Buffer.concat(parts);

        const response = await fetch(`${IMMICH_URL}/api/assets`, {
          method: "POST",
          headers: {
            "x-api-key": API_KEY,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body: bodyBuffer,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to upload asset (HTTP ${response.status}): ${errorBody}`,
              },
            ],
            isError: true,
          };
        }

        const asset = await response.json();

        // If album_id provided, add the asset to the album
        if (album_id && asset.id) {
          const addResponse = await fetch(
            `${IMMICH_URL}/api/albums/${album_id}/assets`,
            {
              method: "PUT",
              headers: {
                "x-api-key": API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ids: [asset.id] }),
            }
          );

          if (!addResponse.ok) {
            const addError = await addResponse.text();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      id: asset.id,
                      status: asset.status ?? "created",
                      warning: `Uploaded but failed to add to album ${album_id}: ${addError}`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: asset.id,
                  status: asset.status ?? "created",
                  duplicate: asset.duplicate ?? false,
                  album_id: album_id ?? null,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to upload photo: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
