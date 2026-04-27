/**
 * list_files tool — lists files in a Seafile library via REST API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const API_BASE = `${getServiceUrl("seafile")}/api2`;

async function getAuthToken(): Promise<string> {
  // Prefer pre-configured token, otherwise authenticate with credentials
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

async function seafileGet(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const token = await getAuthToken();
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Token ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Seafile API error (HTTP ${response.status}): ${text}`
    );
  }

  return response.json();
}

export function registerListFiles(server: McpServer): void {
  server.tool(
    "list_files",
    "List files and directories in a Seafile library",
    {
      library_id: z
        .string()
        .optional()
        .describe(
          "Seafile library/repo ID. If omitted, lists all libraries."
        ),
      path: z
        .string()
        .optional()
        .describe("Directory path within the library (default: root '/')"),
    },
    async ({ library_id, path }) => {
      try {
        // If no library_id, list all libraries
        if (!library_id) {
          const repos = await seafileGet("/repos/");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, libraries: repos },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // List directory contents within a library
        const dirPath = path ?? "/";
        const entries = await seafileGet(`/repos/${library_id}/dir/`, {
          p: dirPath,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  library_id,
                  path: dirPath,
                  entries,
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
