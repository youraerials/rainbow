/**
 * send_email tool — sends an email via Stalwart's JMAP API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const JMAP_URL = `${getServiceUrl("stalwart")}/jmap`;

/** JMAP credentials from environment. */
function getAuth(): string {
  const user = process.env.STALWART_USER ?? "admin";
  const pass = process.env.STALWART_PASSWORD ?? "";
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

/**
 * Makes a JMAP API request.
 */
async function jmapRequest(methodCalls: unknown[]): Promise<unknown> {
  const response = await fetch(JMAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${getAuth()}`,
    },
    body: JSON.stringify({
      using: [
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:submission",
      ],
      methodCalls,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JMAP request failed (HTTP ${response.status}): ${text}`);
  }

  return response.json();
}

export function registerSendEmail(server: McpServer): void {
  server.tool(
    "send_email",
    "Send an email via Stalwart JMAP",
    {
      to: z.array(z.string().email()).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text"),
      cc: z.array(z.string().email()).optional().describe("CC recipients"),
      bcc: z.array(z.string().email()).optional().describe("BCC recipients"),
    },
    async ({ to, subject, body, cc, bcc }) => {
      try {
        // Step 1: Get the account ID from the JMAP session
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
        if (!accountId) {
          throw new Error("Could not determine primary mail account ID");
        }

        // Build address objects
        const toAddresses = to.map((email) => ({ email }));
        const ccAddresses = cc?.map((email) => ({ email })) ?? [];
        const bccAddresses = bcc?.map((email) => ({ email })) ?? [];

        // Step 2: Create the draft and send it via JMAP
        const emailId = `draft-${Date.now()}`;
        const result = await jmapRequest([
          [
            "Email/set",
            {
              accountId,
              create: {
                [emailId]: {
                  mailboxIds: {}, // Will be routed by submission
                  to: toAddresses,
                  cc: ccAddresses.length > 0 ? ccAddresses : undefined,
                  bcc: bccAddresses.length > 0 ? bccAddresses : undefined,
                  subject,
                  bodyValues: {
                    body: { value: body, isEncodingProblem: false },
                  },
                  textBody: [{ partId: "body", type: "text/plain" }],
                },
              },
            },
            "0",
          ],
          [
            "EmailSubmission/set",
            {
              accountId,
              create: {
                submission: {
                  emailId: `#${emailId}`,
                  envelope: {
                    mailFrom: {
                      email:
                        process.env.STALWART_FROM_EMAIL ??
                        process.env.STALWART_USER ??
                        "admin@localhost",
                    },
                    rcptTo: [
                      ...toAddresses,
                      ...ccAddresses,
                      ...bccAddresses,
                    ].map((addr) => ({ email: addr.email })),
                  },
                },
              },
              onSuccessUpdateEmail: {
                "#submission": {
                  "mailboxIds/inbox": null,
                  "keywords/$sent": true,
                },
              },
            },
            "1",
          ],
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Email sent to ${to.join(", ")}`,
                  subject,
                  details: result,
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
