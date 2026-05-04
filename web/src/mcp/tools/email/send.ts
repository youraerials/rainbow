/**
 * email.send — send a message from the user's primary identity.
 *
 * JMAP send is a 4-step dance: build the Email/set draft, capture its id,
 * then EmailSubmission/set the submission referencing that draft. We do
 * both in a single request (call backreferences via "#submission").
 *
 * Stalwart auto-creates an Identity for the authenticated user on first
 * EmailSubmission, so we don't have to manage Identity/set separately.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jmap, accountId, JmapCall } from "./client.js";

interface IdentityGetResp {
    methodResponses: Array<[
        "Identity/get",
        { list?: Array<{ id: string; email: string; name?: string }> },
        string,
    ]>;
}

interface SendResp {
    methodResponses: Array<
        | ["Email/set", { created?: Record<string, { id: string }>; notCreated?: Record<string, { type: string; description?: string }> }, string]
        | ["EmailSubmission/set", { created?: Record<string, { id: string }>; notCreated?: Record<string, { type: string; description?: string }> }, string]
    >;
}

export function registerSendEmail(server: McpServer): void {
    server.tool(
        "email.send",
        "Send an email from the user's primary identity. The message is also saved to the Sent mailbox.",
        {
            to: z
                .array(z.string())
                .min(1)
                .describe("Recipient email addresses (one or more)"),
            cc: z.array(z.string()).optional().describe("CC recipients"),
            bcc: z.array(z.string()).optional().describe("BCC recipients"),
            subject: z.string().describe("Subject line"),
            body: z.string().describe("Plain-text body of the message"),
            html: z.string().optional().describe("Optional HTML alternative body"),
            in_reply_to: z
                .string()
                .optional()
                .describe("Message-ID header value to thread under (for replies)"),
        },
        async ({ to, cc, bcc, subject, body, html, in_reply_to }) => {
            try {
                const acct = await accountId();

                // Find the user's identity (the first one if multiple).
                const idResp = await jmap<IdentityGetResp>([
                    ["Identity/get", { accountId: acct }, "0"],
                ]);
                if (!idResp.ok || !idResp.data) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Identity/get failed: ${idResp.error ?? "unknown"}` }],
                    };
                }
                const ident = idResp.data.methodResponses[0]?.[1]?.list?.[0];
                if (!ident) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: "No JMAP Identity available — Stalwart hasn't provisioned one for this account yet." }],
                    };
                }

                // Find the Drafts and Sent mailboxes (we save the outgoing message
                // into Sent so it appears in Sent rather than as a stranded draft).
                const mboxResp = await jmap<{
                    methodResponses: Array<["Mailbox/get", { list?: Array<{ id: string; role?: string }> }, string]>;
                }>([["Mailbox/get", { accountId: acct, properties: ["id", "role"] }, "0"]]);
                const mailboxes = mboxResp.data?.methodResponses[0]?.[1]?.list ?? [];
                const draftsId = mailboxes.find((m) => m.role === "drafts")?.id;
                const sentId = mailboxes.find((m) => m.role === "sent")?.id;
                if (!draftsId || !sentId) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: "Stalwart account is missing Drafts or Sent mailbox role — set up wizard hasn't finished." }],
                    };
                }

                // Build Email/set + EmailSubmission/set in one round-trip.
                // The submission references the email via "#draft" backref.
                const bodyValues: Record<string, { value: string; charset?: string }> = {
                    text: { value: body, charset: "utf-8" },
                };
                const bodyStructure: Record<string, unknown> = html
                    ? {
                          type: "multipart/alternative",
                          subParts: [
                              { partId: "text", type: "text/plain" },
                              { partId: "html", type: "text/html" },
                          ],
                      }
                    : { partId: "text", type: "text/plain" };
                if (html) bodyValues.html = { value: html, charset: "utf-8" };

                const calls: JmapCall[] = [
                    [
                        "Email/set",
                        {
                            accountId: acct,
                            create: {
                                draft: {
                                    mailboxIds: { [draftsId]: true },
                                    keywords: { $seen: true, $draft: true },
                                    from: [{ email: ident.email, name: ident.name }],
                                    to: to.map((e) => ({ email: e })),
                                    ...(cc && cc.length ? { cc: cc.map((e) => ({ email: e })) } : {}),
                                    ...(bcc && bcc.length ? { bcc: bcc.map((e) => ({ email: e })) } : {}),
                                    subject,
                                    ...(in_reply_to ? { inReplyTo: [in_reply_to] } : {}),
                                    bodyValues,
                                    bodyStructure,
                                },
                            },
                        },
                        "draft",
                    ],
                    [
                        "EmailSubmission/set",
                        {
                            accountId: acct,
                            create: {
                                submission: {
                                    identityId: ident.id,
                                    emailId: "#draft",
                                    envelope: {
                                        mailFrom: { email: ident.email },
                                        rcptTo: [
                                            ...to.map((e) => ({ email: e })),
                                            ...(cc ?? []).map((e) => ({ email: e })),
                                            ...(bcc ?? []).map((e) => ({ email: e })),
                                        ],
                                    },
                                },
                            },
                            // Move the draft from Drafts → Sent on successful submission.
                            onSuccessUpdateEmail: {
                                "#submission": {
                                    [`mailboxIds/${draftsId}`]: null,
                                    [`mailboxIds/${sentId}`]: true,
                                    "keywords/$draft": null,
                                },
                            },
                        },
                        "submission",
                    ],
                ];

                const resp = await jmap<SendResp>(calls, 30000);
                if (!resp.ok || !resp.data) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Send failed: ${resp.error ?? "unknown"}` }],
                    };
                }

                const setResult = resp.data.methodResponses[0]?.[1] as { notCreated?: Record<string, { type: string; description?: string }> } | undefined;
                if (setResult?.notCreated?.draft) {
                    const err = setResult.notCreated.draft;
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Email/set rejected: ${err.type}${err.description ? ` — ${err.description}` : ""}` }],
                    };
                }
                const subResult = resp.data.methodResponses[1]?.[1] as { created?: Record<string, { id: string }>; notCreated?: Record<string, { type: string; description?: string }> } | undefined;
                if (subResult?.notCreated?.submission) {
                    const err = subResult.notCreated.submission;
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `EmailSubmission rejected: ${err.type}${err.description ? ` — ${err.description}` : ""}` }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                sent: true,
                                from: ident.email,
                                to,
                                cc: cc ?? [],
                                bcc: bcc ?? [],
                                subject,
                                submissionId: subResult?.created?.submission?.id,
                            }),
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}
