/**
 * download_file tool — downloads a file from Seafile via REST API.
 *
 * Returns the file content as base64-encoded text.
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

export function registerDownloadFile(server: McpServer): void {
  server.tool(
    "download_file",
    "Download a file from a Seafile library (returns base64 content)",
    {
      library_id: z.string().describe("Seafile library/repo ID"),
      path: z.string().describe("File path within the library"),
    },
    async ({ library_id, path }) => {
      try {
        const token = await getAuthToken();

        // Step 1: Get download link
        const linkRes = await fetch(
          `${API_BASE}/repos/${library_id}/file/?p=${encodeURIComponent(path)}`,
          {
            headers: { Authorization: `Token ${token}` },
          }
        );

        if (!linkRes.ok) {
          const text = await linkRes.text();
          throw new Error(
            `Failed to get download link (HTTP ${linkRes.status}): ${text}`
          );
        }

        // Response is a JSON string (quoted URL)
        const downloadUrl = ((await linkRes.json()) as string).replace(
          /"/g,
          ""
        );

        // Step 2: Download the file content
        const fileRes = await fetch(downloadUrl, {
          headers: { Authorization: `Token ${token}` },
        });

        if (!fileRes.ok) {
          throw new Error(`Download failed (HTTP ${fileRes.status})`);
        }

        const arrayBuffer = await fileRes.arrayBuffer();
        const base64Content = Buffer.from(arrayBuffer).toString("base64");
        const sizeBytes = arrayBuffer.byteLength;

        // Determine if this is likely a text file
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        const textExtensions = [
          "txt",
          "md",
          "csv",
          "json",
          "xml",
          "html",
          "css",
          "js",
          "ts",
          "py",
          "yaml",
          "yml",
          "toml",
          "ini",
          "cfg",
          "log",
          "sh",
        ];
        const isText = textExtensions.includes(ext);

        let textContent: string | undefined;
        if (isText && sizeBytes < 1_000_000) {
          textContent = Buffer.from(arrayBuffer).toString("utf-8");
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  library_id,
                  path,
                  size_bytes: sizeBytes,
                  content_base64: base64Content,
                  ...(textContent !== undefined
                    ? { text_content: textContent }
                    : {}),
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
