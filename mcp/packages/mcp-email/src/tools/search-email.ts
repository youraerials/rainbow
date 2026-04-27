/**
 * search_email tool — searches emails via Stalwart's JMAP API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const JMAP_URL = `${getServiceUrl("stalwart")}/jmap`;

function getAuth(): string {
  const user = process.env.STALWART_USER ?? "admin";
  const pass = process.env.STALWART_PASSWORD ?? "";
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

async function jmapRequest(methodCalls: unknown[]): Promise<unknown> {
  const response = await fetch(JMAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${getAuth()}`,
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JMAP request failed (HTTP ${response.status}): ${text}`);
  }

  return response.json();
}

export function registerSearchEmail(server: McpServer): void {
  server.tool(
    "search_email",
    "Search emails in Stalwart via JMAP",
    {
      query: z.string().describe("Search query text"),
      folder: z
        .string()
        .optional()
        .describe("Mailbox name to search in (e.g. 'Inbox', 'Sent')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of results (default 20)"),
    },
    async ({ query, folder, limit }) => {
      const maxResults = limit ?? 20;

      try {
        // Get account ID from session
        const sessionRes = await fetch(JMAP_URL, {
          headers: { Authorization: `Basic ${getAuth()}` },
        });
        if (!sessionRes.ok) {
          throw new Error(`Failed to get JMAP session: HTTP ${sessionRes.status}`);
        }
        const session = (await sessionRes.json()) as {
          primaryAccounts: Record<string, string>;
        };
        const accountId =
          session.primaryAccounts["urn:ietf:params:jmap:mail"];

        // Build the filter
        const filter: Record<string, unknown> = { text: query };

        // If a folder is specified, resolve mailbox ID first
        if (folder) {
          const mbResult = (await jmapRequest([
            [
              "Mailbox/query",
              { accountId, filter: { name: folder } },
              "mb",
            ],
          ])) as { methodResponses: [string, { ids: string[] }, string][] };
          const mbIds = mbResult.methodResponses?.[0]?.[1]?.ids;
          if (mbIds && mbIds.length > 0) {
            filter.inMailbox = mbIds[0];
          }
        }

        // Query and fetch emails
        const result = (await jmapRequest([
          [
            "Email/query",
            {
              accountId,
              filter,
              sort: [{ property: "receivedAt", isAscending: false }],
              limit: maxResults,
            },
            "0",
          ],
          [
            "Email/get",
            {
              accountId,
              "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
              properties: [
                "id",
                "subject",
                "from",
                "to",
                "receivedAt",
                "preview",
                "size",
                "hasAttachment",
              ],
            },
            "1",
          ],
        ])) as { methodResponses: [string, Record<string, unknown>, string][] };

        const emails = result.methodResponses?.[1]?.[1]?.list ?? [];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, count: (emails as unknown[]).length, emails },
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
