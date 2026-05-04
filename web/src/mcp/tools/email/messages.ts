/**
 * email.list_messages — list messages in a mailbox (or across the account).
 * email.read       — fetch the full body of one message by id.
 *
 * Wraps JMAP's Email/query and Email/get methods.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jmap, accountId } from "./client.js";

interface EmailQueryResp {
    methodResponses: Array<["Email/query", { ids?: string[]; total?: number }, string]>;
}

interface EmailGetResp {
    methodResponses: Array<[
        "Email/get",
        {
            list?: Array<{
                id: string;
                threadId?: string;
                from?: Array<{ email: string; name?: string }>;
                to?: Array<{ email: string; name?: string }>;
                subject?: string;
                receivedAt?: string;
                preview?: string;
                hasAttachment?: boolean;
                keywords?: Record<string, boolean>;
                bodyValues?: Record<string, { value: string; isTruncated?: boolean }>;
                textBody?: Array<{ partId?: string; type: string }>;
                htmlBody?: Array<{ partId?: string; type: string }>;
            }>;
        },
        string,
    ]>;
}

const LIST_PROPS = [
    "id",
    "threadId",
    "from",
    "to",
    "subject",
    "receivedAt",
    "preview",
    "hasAttachment",
    "keywords",
];

export function registerListMessages(server: McpServer): void {
    server.tool(
        "email.list_messages",
        "List messages, optionally filtered to one mailbox or unread-only. Returns headers + previews, not full bodies.",
        {
            mailbox_id: z
                .string()
                .optional()
                .describe("Restrict to one mailbox (use email.list_mailboxes to find IDs); omit for all"),
            unread_only: z
                .boolean()
                .optional()
                .describe("Only messages with $seen=false"),
            limit: z
                .number()
                .int()
                .positive()
                .max(100)
                .optional()
                .describe("Max results (default 25)"),
        },
        async ({ mailbox_id, unread_only, limit }) => {
            try {
                const acct = await accountId();
                const filter: Record<string, unknown> = {};
                if (mailbox_id) filter.inMailbox = mailbox_id;
                if (unread_only) filter.notKeyword = "$seen";

                const queryResp = await jmap<EmailQueryResp>([
                    [
                        "Email/query",
                        {
                            accountId: acct,
                            filter,
                            sort: [{ property: "receivedAt", isAscending: false }],
                            limit: limit ?? 25,
                        },
                        "0",
                    ],
                ]);
                if (!queryResp.ok || !queryResp.data) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Email/query failed: ${queryResp.error ?? "unknown"}` }],
                    };
                }
                const ids = queryResp.data.methodResponses[0]?.[1]?.ids ?? [];
                const total = queryResp.data.methodResponses[0]?.[1]?.total ?? ids.length;

                if (ids.length === 0) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({ count: 0, total: 0, messages: [] }) }] };
                }

                const getResp = await jmap<EmailGetResp>([
                    ["Email/get", { accountId: acct, ids, properties: LIST_PROPS }, "0"],
                ]);
                const list = getResp.data?.methodResponses[0]?.[1]?.list ?? [];
                const messages = list.map((m) => ({
                    id: m.id,
                    thread_id: m.threadId,
                    from: m.from?.map((f) => f.email).join(", "),
                    to: m.to?.map((t) => t.email).join(", "),
                    subject: m.subject ?? "(no subject)",
                    received_at: m.receivedAt,
                    preview: m.preview,
                    unread: m.keywords ? !m.keywords.$seen : true,
                    has_attachment: m.hasAttachment ?? false,
                }));
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ count: messages.length, total, messages }, null, 2) }],
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

export function registerReadEmail(server: McpServer): void {
    server.tool(
        "email.read",
        "Fetch a single message's full text body and headers by ID. Use email.list_messages or email.search to find IDs.",
        {
            id: z.string().describe("JMAP Email id"),
            include_html: z
                .boolean()
                .optional()
                .describe("Also include the HTML body if present (default false — text only)"),
        },
        async ({ id, include_html }) => {
            try {
                const acct = await accountId();
                const fetchProps = [
                    ...LIST_PROPS,
                    "bodyValues",
                    "textBody",
                    "htmlBody",
                ];
                const resp = await jmap<EmailGetResp>([
                    [
                        "Email/get",
                        {
                            accountId: acct,
                            ids: [id],
                            properties: fetchProps,
                            fetchTextBodyValues: true,
                            ...(include_html ? { fetchHTMLBodyValues: true } : {}),
                        },
                        "0",
                    ],
                ]);
                if (!resp.ok || !resp.data) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Email/get failed: ${resp.error ?? "unknown"}` }],
                    };
                }
                const m = resp.data.methodResponses[0]?.[1]?.list?.[0];
                if (!m) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Message ${id} not found` }],
                    };
                }
                const textPart = m.textBody?.[0]?.partId;
                const htmlPart = include_html ? m.htmlBody?.[0]?.partId : undefined;
                const text = textPart ? m.bodyValues?.[textPart]?.value : undefined;
                const html = htmlPart ? m.bodyValues?.[htmlPart]?.value : undefined;
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    id: m.id,
                                    thread_id: m.threadId,
                                    from: m.from?.map((f) => `${f.name ? `${f.name} ` : ""}<${f.email}>`).join(", "),
                                    to: m.to?.map((t) => `${t.name ? `${t.name} ` : ""}<${t.email}>`).join(", "),
                                    subject: m.subject,
                                    received_at: m.receivedAt,
                                    body: text ?? "(no plain-text body)",
                                    ...(html ? { html_body: html } : {}),
                                },
                                null,
                                2,
                            ),
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
