/**
 * email.search — query the user's mail by sender, recipient, subject, or text.
 *
 * Two-phase JMAP idiom: Email/query returns matching IDs, then a chained
 * Email/get pulls the full envelope+preview for those IDs in one round trip.
 * The `#` reference prefix tells JMAP to feed the prior call's result in.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jmap, accountId, JmapCall } from "./client.js";

interface EmailEnvelope {
    id: string;
    receivedAt?: string;
    subject?: string;
    from?: Array<{ name?: string; email: string }>;
    to?: Array<{ name?: string; email: string }>;
    preview?: string;
    hasAttachment?: boolean;
}

interface SearchResponse {
    methodResponses: Array<
        | ["Email/query", { ids?: string[]; total?: number }, string]
        | ["Email/get", { list?: EmailEnvelope[] }, string]
    >;
}

export function registerSearchEmail(server: McpServer): void {
    server.tool(
        "email.search",
        "Search messages by free-text query, sender, recipient, or subject.",
        {
            query: z
                .string()
                .optional()
                .describe("Free-text search across subject + body"),
            from: z.string().optional().describe("Filter by sender address"),
            to: z.string().optional().describe("Filter by recipient address"),
            mailbox_id: z.string().optional().describe("Restrict to one mailbox"),
            limit: z
                .number()
                .int()
                .positive()
                .max(50)
                .optional()
                .describe("Max results (default 20)"),
        },
        async ({ query, from, to, mailbox_id, limit }) => {
            try {
                const acct = await accountId();
                const filter: Record<string, unknown> = {};
                if (query) filter.text = query;
                if (from) filter.from = from;
                if (to) filter.to = to;
                if (mailbox_id) filter.inMailbox = mailbox_id;
                const calls: JmapCall[] = [
                    [
                        "Email/query",
                        {
                            accountId: acct,
                            filter: Object.keys(filter).length ? filter : undefined,
                            sort: [{ property: "receivedAt", isAscending: false }],
                            limit: limit ?? 20,
                        },
                        "0",
                    ],
                    [
                        "Email/get",
                        {
                            accountId: acct,
                            "#ids": {
                                resultOf: "0",
                                name: "Email/query",
                                path: "/ids",
                            },
                            properties: [
                                "id",
                                "receivedAt",
                                "subject",
                                "from",
                                "to",
                                "preview",
                                "hasAttachment",
                            ],
                        },
                        "1",
                    ],
                ];
                const resp = await jmap<SearchResponse>(calls);
                if (!resp.ok || !resp.data) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text" as const,
                                text: `Stalwart Email/query failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                            },
                        ],
                    };
                }
                const queryRes = resp.data.methodResponses.find(
                    (r) => r[0] === "Email/query",
                ) as
                    | ["Email/query", { ids?: string[]; total?: number }, string]
                    | undefined;
                const getRes = resp.data.methodResponses.find(
                    (r) => r[0] === "Email/get",
                ) as ["Email/get", { list?: EmailEnvelope[] }, string] | undefined;
                const list = getRes?.[1]?.list ?? [];
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    count: list.length,
                                    total: queryRes?.[1]?.total,
                                    results: list.map((m) => ({
                                        id: m.id,
                                        received_at: m.receivedAt,
                                        from: m.from,
                                        to: m.to,
                                        subject: m.subject,
                                        preview: m.preview,
                                        has_attachment: m.hasAttachment ?? false,
                                    })),
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
                    content: [
                        {
                            type: "text" as const,
                            text: `email.search error: ${err instanceof Error ? err.message : String(err)}`,
                        },
                    ],
                };
            }
        },
    );
}
