/**
 * libraries resource — exposes the list of Seafile libraries as an MCP resource.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export function registerLibrariesResource(server: McpServer): void {
  server.resource(
    "libraries",
    "seafile://libraries",
    {
      description: "List of all Seafile libraries accessible to the current user",
      mimeType: "application/json",
    },
    async () => {
      try {
        const token = await getAuthToken();

        const response = await fetch(`${API_BASE}/repos/`, {
          headers: { Authorization: `Token ${token}` },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Seafile API error (HTTP ${response.status}): ${text}`
          );
        }

        const repos = (await response.json()) as Array<{
          id: string;
          name: string;
          size: number;
          owner: string;
          encrypted: boolean;
          mtime: number;
        }>;

        const libraries = repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          size: repo.size,
          owner: repo.owner,
          encrypted: repo.encrypted,
          last_modified: new Date(repo.mtime * 1000).toISOString(),
        }));

        return {
          contents: [
            {
              uri: "seafile://libraries",
              mimeType: "application/json",
              text: JSON.stringify(
                { count: libraries.length, libraries },
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
          contents: [
            {
              uri: "seafile://libraries",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
