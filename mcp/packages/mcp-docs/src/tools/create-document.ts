/**
 * create_document tool — creates a new CryptPad document.
 *
 * CryptPad encrypts content client-side, so this tool creates the pad
 * structure and returns its URL/ID. Content must be edited in the browser.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const CRYPTPAD_URL = getServiceUrl("cryptpad");

const PAD_TYPE_MAP: Record<string, string> = {
  richtext: "pad",
  sheet: "sheet",
  code: "code",
  kanban: "kanban",
  whiteboard: "whiteboard",
};

export function registerCreateDocument(server: McpServer): void {
  server.tool(
    "create_document",
    "Create a new CryptPad document",
    {
      title: z.string().describe("Document title"),
      type: z
        .enum(["richtext", "sheet", "code", "kanban", "whiteboard"])
        .describe("Type of document to create"),
      content: z
        .string()
        .optional()
        .describe(
          "Initial content hint (limited due to client-side encryption)"
        ),
    },
    async ({ title, type, content }) => {
      try {
        const padType = PAD_TYPE_MAP[type];

        // CryptPad's HTTP API for pad creation is limited.
        // We call the internal API to create a pad entry and get its URL.
        const response = await fetch(`${CRYPTPAD_URL}/api/pad/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRYPTPAD_API_TOKEN ?? ""}`,
          },
          body: JSON.stringify({
            type: padType,
            title,
            content: content ?? "",
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `CryptPad API error (HTTP ${response.status}): ${text}`
          );
        }

        const result = (await response.json()) as {
          id: string;
          url: string;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  document_id: result.id,
                  title,
                  document_type: type,
                  url: result.url ?? `${CRYPTPAD_URL}/${padType}/#/2/${result.id}`,
                  message: `Document "${title}" created successfully`,
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
