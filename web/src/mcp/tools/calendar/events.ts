/**
 * calendar.list_events — fetch events in a date range from one calendar.
 * calendar.create_event — write a new VEVENT to a calendar.
 */

import { z } from "zod";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { caldav, parseEventResponses, parseICalEvent } from "./client.js";

function toCalDavDateTime(iso: string, allDay: boolean): string {
    // Convert "2026-05-04T15:30:00Z" → "20260504T153000Z" for CalDAV.
    // For all-day, "2026-05-04" → "20260504" (no time, no Z).
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new Error(`bad ISO datetime: ${iso}`);
    if (allDay) return d.toISOString().slice(0, 10).replace(/-/g, "");
    return d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
}

export function registerListEvents(server: McpServer): void {
    server.tool(
        "calendar.list_events",
        "Fetch events occurring within a time range from a calendar collection. Returns parsed iCalendar fields (summary, start, end, location, etc.).",
        {
            calendar_href: z
                .string()
                .describe("The calendar's href from calendar.list_calendars"),
            start: z.string().describe("ISO 8601 start of the range (e.g. 2026-05-04T00:00:00Z)"),
            end: z.string().describe("ISO 8601 end of the range"),
        },
        async ({ calendar_href, start, end }) => {
            try {
                const startCal = toCalDavDateTime(start, false);
                const endCal = toCalDavDateTime(end, false);
                const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startCal}" end="${endCal}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
                const r = await caldav("REPORT", calendar_href, {
                    body,
                    depth: "1",
                    contentType: 'application/xml; charset="utf-8"',
                });
                if (!r.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `CalDAV REPORT failed: HTTP ${r.status}` }],
                    };
                }
                const events = parseEventResponses(r.text).map(({ href, etag, ical }) => {
                    const props = parseICalEvent(ical);
                    return {
                        href,
                        etag,
                        uid: props.UID,
                        summary: props.SUMMARY,
                        start: props.DTSTART,
                        end: props.DTEND,
                        location: props.LOCATION,
                        description: props.DESCRIPTION,
                        organizer: props.ORGANIZER,
                    };
                });
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ count: events.length, events }, null, 2),
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

export function registerCreateEvent(server: McpServer): void {
    server.tool(
        "calendar.create_event",
        "Create a new event in a calendar. Returns the event's href and UID.",
        {
            calendar_href: z
                .string()
                .describe("Target calendar href from calendar.list_calendars"),
            summary: z.string().describe("Event title"),
            start: z.string().describe("ISO 8601 start (e.g. 2026-05-04T15:30:00Z)"),
            end: z.string().describe("ISO 8601 end"),
            location: z.string().optional().describe("Optional location text"),
            description: z.string().optional().describe("Optional notes / description"),
            all_day: z.boolean().optional().describe("True for an all-day event (date-only)"),
        },
        async ({ calendar_href, summary, start, end, location, description, all_day }) => {
            try {
                const uid = `${crypto.randomUUID()}@rainbow`;
                const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
                const dtstart = toCalDavDateTime(start, all_day === true);
                const dtend = toCalDavDateTime(end, all_day === true);
                // RFC 5545 escaping: backslash, semicolon, comma, newline.
                const esc = (s: string) =>
                    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
                const lines = [
                    "BEGIN:VCALENDAR",
                    "VERSION:2.0",
                    "PRODID:-//Rainbow//rainbow-web//EN",
                    "BEGIN:VEVENT",
                    `UID:${uid}`,
                    `DTSTAMP:${dtstamp}`,
                    all_day ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART:${dtstart}`,
                    all_day ? `DTEND;VALUE=DATE:${dtend}` : `DTEND:${dtend}`,
                    `SUMMARY:${esc(summary)}`,
                    ...(location ? [`LOCATION:${esc(location)}`] : []),
                    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
                    "END:VEVENT",
                    "END:VCALENDAR",
                ];
                const ical = lines.join("\r\n") + "\r\n";

                const targetUrl = calendar_href.endsWith("/")
                    ? `${calendar_href}${uid}.ics`
                    : `${calendar_href}/${uid}.ics`;
                const r = await caldav("PUT", targetUrl, {
                    body: ical,
                    contentType: "text/calendar; charset=utf-8",
                });
                if (!r.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `CalDAV PUT failed: HTTP ${r.status} ${r.text.slice(0, 200)}` }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                created: true,
                                href: targetUrl,
                                uid,
                                etag: r.headers.get("etag"),
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
