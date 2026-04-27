/**
 * Documents resource — exposes a list of recent CryptPad documents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const CRYPTPAD_URL = getServiceUrl("cryptpad");

export function registerDocumentsResource(server: McpServer): void {
  server.resource(
    "recent-documents",
    "docs://recent",
    {
      description: "List of recently modified CryptPad documents",
      mimeType: "application/json",
    },
    async () => {
      try {
        const response = await fetch(`${CRYPTPAD_URL}/api/pad/list?sort=recent&limit=20`, {
          headers: {
            Authorization: `Bearer ${process.env.CRYPTPAD_API_TOKEN ?? ""}`,
          },
        });

        if (!response.ok) {
          throw new Error(`CryptPad API error: HTTP ${response.status}`);
        }

        const documents = await response.json();

        return {
          contents: [
            {
              uri: "docs://recent",
              mimeType: "application/json",
              text: JSON.stringify(documents, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          contents: [
            {
              uri: "docs://recent",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
