/**
 * share_document tool — generates a sharing link for a CryptPad document.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const CRYPTPAD_URL = getServiceUrl("cryptpad");

export function registerShareDocument(server: McpServer): void {
  server.tool(
    "share_document",
    "Generate a sharing link for a CryptPad document",
    {
      doc_id: z.string().describe("The document ID to share"),
      mode: z
        .enum(["view", "edit"])
        .describe("Sharing mode: view-only or edit access"),
    },
    async ({ doc_id, mode }) => {
      try {
        const response = await fetch(`${CRYPTPAD_URL}/api/pad/share`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRYPTPAD_API_TOKEN ?? ""}`,
          },
          body: JSON.stringify({
            id: doc_id,
            mode,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `CryptPad API error (HTTP ${response.status}): ${text}`
          );
        }

        const result = (await response.json()) as {
          url: string;
          expires?: string;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  doc_id,
                  mode,
                  share_url: result.url,
                  expires: result.expires ?? null,
                  message: `Sharing link created with ${mode} access`,
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
