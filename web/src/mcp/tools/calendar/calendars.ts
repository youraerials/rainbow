/**
 * calendar.list_calendars — enumerate the user's CalDAV calendar collections.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listCalendarHrefs } from "./client.js";

export function registerListCalendars(server: McpServer): void {
    server.tool(
        "calendar.list_calendars",
        "List the user's calendar collections (each with a CalDAV href used to query events).",
        {},
        async () => {
            try {
                const cals = await listCalendarHrefs();
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    count: cals.length,
                                    calendars: cals.map((c) => ({
                                        // The href is stable across renames — it's
                                        // the calendar's ID for subsequent calls.
                                        href: c.href,
                                        name: c.displayName || "(unnamed)",
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
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}
