/**
 * User management tools — list, create, delete users via the Authentik API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const AUTHENTIK_URL = getServiceUrl("authentik");
const AUTHENTIK_API = `${AUTHENTIK_URL}/api/v3`;

function getApiToken(): string {
  return process.env.AUTHENTIK_API_TOKEN ?? "";
}

async function authentikFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${AUTHENTIK_API}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiToken()}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Authentik API error (HTTP ${response.status}): ${text}`);
  }

  return response;
}

export function registerUserManagement(server: McpServer): void {
  server.tool(
    "list_users",
    "List all users in Authentik",
    {},
    async () => {
      try {
        const response = await authentikFetch("/core/users/");
        const data = (await response.json()) as {
          results: Array<{
            pk: number;
            username: string;
            name: string;
            email: string;
            is_active: boolean;
            last_login: string | null;
          }>;
        };

        const users = data.results.map((u) => ({
          id: u.pk,
          username: u.username,
          name: u.name,
          email: u.email,
          active: u.is_active,
          last_login: u.last_login,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  count: users.length,
                  users,
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

  server.tool(
    "create_user",
    "Create a new user in Authentik",
    {
      username: z.string().describe("Username for the new user"),
      email: z.string().email().describe("Email address"),
      password: z.string().describe("Initial password"),
    },
    async ({ username, email, password }) => {
      try {
        // Create the user
        const createResponse = await authentikFetch("/core/users/", {
          method: "POST",
          body: JSON.stringify({
            username,
            name: username,
            email,
            is_active: true,
            groups: [],
          }),
        });

        const user = (await createResponse.json()) as { pk: number };

        // Set the password
        await authentikFetch(`/core/users/${user.pk}/set_password/`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `User "${username}" created successfully`,
                  user_id: user.pk,
                  username,
                  email,
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

  server.tool(
    "delete_user",
    "Delete a user from Authentik",
    {
      username: z.string().describe("Username to delete"),
    },
    async ({ username }) => {
      try {
        // Find the user by username
        const searchResponse = await authentikFetch(
          `/core/users/?search=${encodeURIComponent(username)}`
        );
        const searchData = (await searchResponse.json()) as {
          results: Array<{ pk: number; username: string }>;
        };

        const user = searchData.results.find(
          (u) => u.username === username
        );
        if (!user) {
          throw new Error(`User "${username}" not found`);
        }

        // Delete the user
        await authentikFetch(`/core/users/${user.pk}/`, {
          method: "DELETE",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `User "${username}" deleted`,
                  user_id: user.pk,
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
