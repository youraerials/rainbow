/**
 * Email tools — Stalwart JMAP. Disabled at boot if STALWART_JMAP_USER /
 * STALWART_JMAP_PASSWORD aren't set (e.g. the user hasn't completed
 * Stalwart's first-run setup wizard yet — see services/stalwart/README.md).
 *
 * Deferred: email.send. Sending requires DKIM signing and outbound SMTP
 * relaying that we haven't wired up — most receivers reject mail without
 * SPF/DKIM/DMARC, so a working send tool needs the mail-flow infrastructure
 * stood up first.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isConfigured } from "./client.js";
import { registerListMailboxes } from "./list_mailboxes.js";
import { registerSearchEmail } from "./search.js";

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
}
