/**
 * Calendar tools — Stalwart CalDAV. Shares creds with the email tools
 * (STALWART_JMAP_USER + _PASSWORD); disabled if those aren't set.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isConfigured } from "./client.js";
import { registerListCalendars } from "./calendars.js";
import { registerListEvents, registerCreateEvent } from "./events.js";

export function registerCalendarTools(server: McpServer): void {
    if (!isConfigured()) {
        console.warn(
            "[mcp/calendar] STALWART_JMAP_USER/PASSWORD not set — calendar tools disabled.",
        );
        return;
    }
    registerListCalendars(server);
    registerListEvents(server);
    registerCreateEvent(server);
}
