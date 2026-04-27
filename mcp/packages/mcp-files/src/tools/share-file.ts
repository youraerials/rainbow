/**
 * share_file tool — shares a file or directory in Seafile via REST API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const API_BASE = `${getServiceUrl("seafile")}/api2`;

async function getAuthToken(): Promise<string> {
  const token = process.env.SEAFILE_TOKEN;
  if (token) return token;

  const username = process.env.SEAFILE_USER;
  const password = process.env.SEAFILE_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "SEAFILE_TOKEN or SEAFILE_USER/SEAFILE_PASSWORD must be set"
    );
  }

  const response = await fetch(`${API_BASE}/auth-token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Seafile auth failed (HTTP ${response.status}): ${text}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

export function registerShareFile(server: McpServer): void {
  server.tool(
    "share_file",
    "Share a file or directory in Seafile with another user",
    {
      library_id: z.string().describe("Seafile library/repo ID"),
      path: z.string().describe("Path to file or directory to share"),
      share_to_email: z
        .string()
        .email()
        .describe("Email of the user to share with"),
      permission: z
        .enum(["r", "rw"])
        .optional()
        .describe("Permission level: 'r' for read-only, 'rw' for read-write (default: 'r')"),
    },
    async ({ library_id, path, share_to_email, permission }) => {
      try {
        const token = await getAuthToken();
        const perm = permission ?? "r";

        // Determine if the path is a file or directory
        // Try directory share first via the shared folder endpoint
        const isDir = path.endsWith("/") || path === "/";

        if (isDir) {
          // Share a folder
          const response = await fetch(
            `${API_BASE}/repos/${library_id}/dir/shared_items/?p=${encodeURIComponent(path)}`,
            {
              method: "PUT",
              headers: {
                Authorization: `Token ${token}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                share_type: "user",
                username: share_to_email,
                permission: perm,
              }),
            }
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Share folder failed (HTTP ${response.status}): ${text}`
            );
          }

          const result = await response.json();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    type: "folder_share",
                    library_id,
                    path,
                    shared_to: share_to_email,
                    permission: perm,
                    details: result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          // Share a file via share link sent to the user
          const response = await fetch(`${API_BASE}/repos/${library_id}/file/shared-link/`, {
            method: "PUT",
            headers: {
              Authorization: `Token ${token}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              p: path,
              share_type: "user",
              username: share_to_email,
              permission: perm,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Share file failed (HTTP ${response.status}): ${text}`
            );
          }

          // The share link may be in the Location header or body
          const shareLink =
            response.headers.get("Location") ?? (await response.text());

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    type: "file_share",
                    library_id,
                    path,
                    shared_to: share_to_email,
                    permission: perm,
                    share_link: shareLink,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
