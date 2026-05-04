/**
 * Email tools — Stalwart JMAP. Disabled at boot if STALWART_JMAP_USER /
 * STALWART_JMAP_PASSWORD aren't set (e.g. the user hasn't completed
 * Stalwart's first-run setup wizard yet — see services/stalwart/README.md).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isConfigured } from "./client.js";
import { registerListMailboxes } from "./list_mailboxes.js";
import { registerSearchEmail } from "./search.js";
import { registerListMessages, registerReadEmail } from "./messages.js";
import { registerSendEmail } from "./send.js";

export function registerEmailTools(server: McpServer): void {
    if (!isConfigured()) {
        console.warn(
            "[mcp/email] STALWART_JMAP_USER/PASSWORD not set — email tools disabled. " +
                "Complete Stalwart setup (see services/stalwart/README.md) and store creds in Keychain.",
        );
        return;
    }
    registerListMailboxes(server);
    registerSearchEmail(server);
    registerListMessages(server);
    registerReadEmail(server);
    registerSendEmail(server);
}
