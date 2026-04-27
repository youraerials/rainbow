/**
 * search_files tool — searches across all Seafile libraries via REST API.
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

export function registerSearchFiles(server: McpServer): void {
  server.tool(
    "search_files",
    "Search for files across all Seafile libraries",
    {
      query: z.string().describe("Search query string"),
    },
    async ({ query }) => {
      try {
        const token = await getAuthToken();

        const url = new URL(`${API_BASE}/search/`);
        url.searchParams.set("q", query);

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Token ${token}` },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Search failed (HTTP ${response.status}): ${text}`
          );
        }

        const result = (await response.json()) as {
          total: number;
          results: Array<{
            repo_id: string;
            name: string;
            fullpath: string;
            size: number;
            is_dir: boolean;
            last_modified: string;
          }>;
          has_more: boolean;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  total: result.total,
                  has_more: result.has_more,
                  results: result.results,
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
