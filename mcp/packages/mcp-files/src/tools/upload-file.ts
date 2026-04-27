/**
 * upload_file tool — uploads a file to Seafile via REST API.
 *
 * Seafile upload is a two-step process:
 *   1. Get an upload link for the library
 *   2. POST the file content to that link
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

export function registerUploadFile(server: McpServer): void {
  server.tool(
    "upload_file",
    "Upload a file to a Seafile library",
    {
      library_id: z.string().describe("Target Seafile library/repo ID"),
      path: z
        .string()
        .describe("Destination path including filename (e.g. '/docs/report.pdf')"),
      content_base64: z
        .string()
        .describe("File content encoded as base64"),
    },
    async ({ library_id, path, content_base64 }) => {
      try {
        const token = await getAuthToken();

        // Step 1: Get the upload link
        const parentDir = path.substring(0, path.lastIndexOf("/")) || "/";
        const fileName = path.substring(path.lastIndexOf("/") + 1);

        const linkRes = await fetch(
          `${API_BASE}/repos/${library_id}/upload-link/?p=${encodeURIComponent(parentDir)}`,
          {
            headers: { Authorization: `Token ${token}` },
          }
        );

        if (!linkRes.ok) {
          const text = await linkRes.text();
          throw new Error(
            `Failed to get upload link (HTTP ${linkRes.status}): ${text}`
          );
        }

        // The response is a JSON string (quoted URL)
        const uploadUrl = ((await linkRes.json()) as string).replace(/"/g, "");

        // Step 2: Upload the file via multipart form
        const fileBuffer = Buffer.from(content_base64, "base64");
        const blob = new Blob([fileBuffer]);

        const formData = new FormData();
        formData.append("file", blob, fileName);
        formData.append("filename", fileName);
        formData.append("parent_dir", parentDir);

        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Token ${token}`,
          },
          body: formData,
        });

        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          throw new Error(
            `Upload failed (HTTP ${uploadRes.status}): ${text}`
          );
        }

        const result = await uploadRes.text();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  library_id,
                  path,
                  message: `File uploaded to ${path}`,
                  details: result,
                },
                null,
                2
              ),
            },
          ],
        };
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
