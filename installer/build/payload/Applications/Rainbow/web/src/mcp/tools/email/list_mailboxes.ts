/**
 * email.list_mailboxes — enumerate the user's JMAP mailboxes (Inbox, Sent,
 * Drafts, Trash, plus any custom folders).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jmap, accountId, JmapCall } from "./client.js";

interface Mailbox {
    id: string;
    name: string;
    role?: string;
    totalEmails?: number;
    unreadEmails?: number;
}

interface MailboxGetResponse {
    methodResponses: Array<["Mailbox/get", { list?: Mailbox[] }, string]>;
}

export function registerListMailboxes(server: McpServer): void {
    server.tool(
        "email.list_mailboxes",
        "List all mailboxes (folders) in the user's account.",
        {},
        async () => {
            try {
                const acct = await accountId();
                const calls: JmapCall[] = [
                    [
                        "Mailbox/get",
                        {
                            accountId: acct,
                            properties: ["id", "name", "role", "totalEmails", "unreadEmails"],
                        },
                        "0",
                    ],
                ];
                const resp = await jmap<MailboxGetResponse>(calls);
                if (!resp.ok || !resp.data) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text" as const,
                                text: `Stalwart Mailbox/get failed (HTTP ${resp.status}): ${resp.error ?? "unknown"}`,
                            },
                        ],
                    };
                }
                const list = resp.data.methodResponses[0]?.[1]?.list ?? [];
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    count: list.length,
                                    mailboxes: list.map((m) => ({
                                        id: m.id,
                                        name: m.name,
                                        role: m.role,
                                        total: m.totalEmails,
                                        unread: m.unreadEmails,
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
                            text: `email.list_mailboxes error: ${err instanceof Error ? err.message : String(err)}`,
                        },
                    ],
                };
            }
        },
    );
}
