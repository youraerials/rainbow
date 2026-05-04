/**
 * users.me — return the currently-authenticated user's identity. Read
 * from the JWT that gated the MCP request, propagated via AsyncLocalStorage
 * by attachMcp's middleware.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCurrentUser } from "../../server.js";

export function registerMe(server: McpServer): void {
    server.tool(
        "users.me",
        "Return the email, name, and groups of the user currently calling this MCP gateway.",
        {},
        async () => {
            const user = getCurrentUser();
            if (!user) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: "no authenticated user on the current request" }],
                };
            }
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                sub: user.sub,
                                email: user.email,
                                name: user.name,
                                preferred_username: user.preferredUsername,
                                // groups come straight from the JWT claim Authentik
                                // emits; not in our typed user shape, so we read off
                                // the raw payload.
                                groups: (user.raw as { groups?: unknown }).groups ?? [],
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}
