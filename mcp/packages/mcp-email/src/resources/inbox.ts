/**
 * inbox resource — exposes recent inbox messages as an MCP resource.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const JMAP_URL = `${getServiceUrl("stalwart")}/jmap`;

function getAuth(): string {
  const user = process.env.STALWART_USER ?? "admin";
  const pass = process.env.STALWART_PASSWORD ?? "";
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

export function registerInboxResource(server: McpServer): void {
  server.resource(
    "inbox",
    "email://inbox/recent",
    {
      description: "Recent inbox messages from Stalwart mail server",
      mimeType: "application/json",
    },
    async () => {
      try {
        // Get JMAP session for account ID
        const sessionRes = await fetch(JMAP_URL, {
          headers: { Authorization: `Basic ${getAuth()}` },
        });
        if (!sessionRes.ok) {
          throw new Error(`JMAP session failed: HTTP ${sessionRes.status}`);
        }
        const session = (await sessionRes.json()) as {
          primaryAccounts: Record<string, string>;
        };
        const accountId =
          session.primaryAccounts["urn:ietf:params:jmap:mail"];

        // Fetch the Inbox mailbox ID
        const mbResponse = await fetch(JMAP_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${getAuth()}`,
          },
          body: JSON.stringify({
            using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            methodCalls: [
              [
                "Mailbox/query",
                { accountId, filter: { role: "inbox" } },
                "mb",
              ],
            ],
          }),
        });

        const mbResult = (await mbResponse.json()) as {
          methodResponses: [string, { ids: string[] }, string][];
        };
        const inboxId = mbResult.methodResponses?.[0]?.[1]?.ids?.[0];

        if (!inboxId) {
          throw new Error("Could not find Inbox mailbox");
        }

        // Query recent messages
        const emailResponse = await fetch(JMAP_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${getAuth()}`,
          },
          body: JSON.stringify({
            using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            methodCalls: [
              [
                "Email/query",
                {
                  accountId,
                  filter: { inMailbox: inboxId },
                  sort: [{ property: "receivedAt", isAscending: false }],
                  limit: 25,
                },
                "0",
              ],
              [
                "Email/get",
                {
                  accountId,
                  "#ids": {
                    resultOf: "0",
                    name: "Email/query",
                    path: "/ids",
                  },
                  properties: [
                    "id",
                    "subject",
                    "from",
                    "to",
                    "receivedAt",
                    "preview",
                    "keywords",
                    "hasAttachment",
                  ],
                },
                "1",
              ],
            ],
          }),
        });

        const emailResult = (await emailResponse.json()) as {
          methodResponses: [string, Record<string, unknown>, string][];
        };
        const emails = emailResult.methodResponses?.[1]?.[1]?.list ?? [];

        return {
          contents: [
            {
              uri: "email://inbox/recent",
              mimeType: "application/json",
              text: JSON.stringify(
                { count: (emails as unknown[]).length, messages: emails },
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
              uri: "email://inbox/recent",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
