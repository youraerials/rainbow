/**
 * list_documents tool — lists CryptPad documents with optional filtering.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const CRYPTPAD_URL = getServiceUrl("cryptpad");

export function registerListDocuments(server: McpServer): void {
  server.tool(
    "list_documents",
    "List CryptPad documents, optionally filtered by type or search term",
    {
      type: z
        .enum(["richtext", "sheet", "code", "kanban", "whiteboard"])
        .optional()
        .describe("Filter by document type"),
      search: z
        .string()
        .optional()
        .describe("Search term to filter document titles"),
    },
    async ({ type, search }) => {
      try {
        const params = new URLSearchParams();
        if (type) params.set("type", type);
        if (search) params.set("search", search);

        const url = `${CRYPTPAD_URL}/api/pad/list${params.toString() ? `?${params}` : ""}`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${process.env.CRYPTPAD_API_TOKEN ?? ""}`,
          },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `CryptPad API error (HTTP ${response.status}): ${text}`
          );
        }

        const documents = (await response.json()) as Array<{
          id: string;
          title: string;
          type: string;
          created: string;
          last_modified: string;
        }>;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  count: documents.length,
                  documents,
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
