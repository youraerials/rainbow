/**
 * share_album tool — Share an Immich album with other users.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const IMMICH_URL = getServiceUrl("immich");
const API_KEY = process.env.IMMICH_API_KEY ?? "";

export function registerShareAlbum(server: McpServer): void {
  server.tool(
    "share_album",
    "Share an Immich album with other users",
    {
      album_id: z.string().describe("Album ID to share"),
      user_ids: z
        .array(z.string())
        .describe("User IDs to share the album with"),
    },
    async ({ album_id, user_ids }) => {
      try {
        const sharedUsers = user_ids.map((id) => ({ userId: id, role: "viewer" }));

        const response = await fetch(
          `${IMMICH_URL}/api/albums/${album_id}/users`,
          {
            method: "PUT",
            headers: {
              "x-api-key": API_KEY,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ sharedUserIds: sharedUsers }),
          }
        );

        if (!response.ok) {
          const errorBody = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to share album (HTTP ${response.status}): ${errorBody}`,
              },
            ],
            isError: true,
          };
        }

        const album = await response.json();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  album_id: album.id,
                  name: album.albumName,
                  shared_with: (album.sharedUsers ?? []).map(
                    (u: Record<string, unknown>) => ({
                      id: u.id,
                      email: u.email,
                    })
                  ),
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
              text: `Failed to share album: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
