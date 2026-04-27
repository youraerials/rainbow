/**
 * Calendar management tools — create, list, and delete events via CalDAV.
 *
 * Uses Stalwart's CalDAV endpoint at /dav to manage calendar events
 * with iCalendar (RFC 5545) format.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getServiceUrl } from "@rainbow/mcp-common";

const DAV_BASE = `${getServiceUrl("stalwart")}/dav`;

function getAuth(): string {
  const user = process.env.STALWART_USER ?? "admin";
  const pass = process.env.STALWART_PASSWORD ?? "";
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

function getCalendarUrl(): string {
  const user = process.env.STALWART_USER ?? "admin";
  return `${DAV_BASE}/calendars/user/${user}/default`;
}

/**
 * Formats a Date-compatible string into iCalendar DTSTART/DTEND format.
 * Expects ISO 8601 input like "2026-04-27T10:00:00".
 */
function toICalDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace("Z", "") + "Z";
}

/**
 * Generates a simple UUID v4 for event IDs.
 */
function generateUid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds an iCalendar VEVENT string.
 */
function buildICalEvent(params: {
  uid: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rainbow//MCP Email//EN",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTART:${toICalDate(params.start)}`,
    `DTEND:${toICalDate(params.end)}`,
    `SUMMARY:${params.title}`,
    `DTSTAMP:${toICalDate(new Date().toISOString())}`,
  ];

  if (params.description) {
    lines.push(`DESCRIPTION:${params.description.replace(/\n/g, "\\n")}`);
  }
  if (params.location) {
    lines.push(`LOCATION:${params.location}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function registerCalendarTools(server: McpServer): void {
  // ── create_event ──────────────────────────────────────────────

  server.tool(
    "create_event",
    "Create a calendar event via CalDAV",
    {
      title: z.string().describe("Event title/summary"),
      start: z.string().describe("Start time in ISO 8601 format"),
      end: z.string().describe("End time in ISO 8601 format"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
    },
    async ({ title, start, end, description, location }) => {
      try {
        const uid = generateUid();
        const ical = buildICalEvent({
          uid,
          title,
          start,
          end,
          description,
          location,
        });

        const eventUrl = `${getCalendarUrl()}/${uid}.ics`;

        const response = await fetch(eventUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            Authorization: `Basic ${getAuth()}`,
            "If-None-Match": "*", // Only create, do not overwrite
          },
          body: ical,
        });

        if (!response.ok && response.status !== 201) {
          const text = await response.text();
          throw new Error(
            `CalDAV PUT failed (HTTP ${response.status}): ${text}`
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  event_id: uid,
                  title,
                  start,
                  end,
                  url: eventUrl,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── list_events ───────────────────────────────────────────────

  server.tool(
    "list_events",
    "List calendar events in a date range via CalDAV REPORT",
    {
      start_date: z
        .string()
        .describe("Start of range in ISO 8601 (e.g. 2026-04-01)"),
      end_date: z
        .string()
        .describe("End of range in ISO 8601 (e.g. 2026-04-30)"),
    },
    async ({ start_date, end_date }) => {
      try {
        const calUrl = getCalendarUrl();

        // CalDAV REPORT with calendar-query for time range
        const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${toICalDate(start_date + "T00:00:00Z")}" end="${toICalDate(end_date + "T23:59:59Z")}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

        const response = await fetch(calUrl, {
          method: "REPORT",
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            Authorization: `Basic ${getAuth()}`,
            Depth: "1",
          },
          body: reportBody,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `CalDAV REPORT failed (HTTP ${response.status}): ${text}`
          );
        }

        const xmlText = await response.text();

        // Parse out VEVENT summaries from the raw response.
        // A full XML parser would be better, but for MCP tool output
        // we extract the essential iCalendar data.
        const events: Array<Record<string, string>> = [];
        const eventBlocks = xmlText.split("BEGIN:VEVENT");

        for (let i = 1; i < eventBlocks.length; i++) {
          const block = eventBlocks[i].split("END:VEVENT")[0];
          const extract = (key: string): string => {
            const match = block.match(new RegExp(`${key}[^:]*:(.+)`));
            return match?.[1]?.trim() ?? "";
          };

          events.push({
            uid: extract("UID"),
            summary: extract("SUMMARY"),
            start: extract("DTSTART"),
            end: extract("DTEND"),
            location: extract("LOCATION"),
            description: extract("DESCRIPTION"),
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, count: events.length, events },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── delete_event ──────────────────────────────────────────────

  server.tool(
    "delete_event",
    "Delete a calendar event by its UID",
    {
      event_id: z.string().describe("The UID of the event to delete"),
    },
    async ({ event_id }) => {
      try {
        const eventUrl = `${getCalendarUrl()}/${event_id}.ics`;

        const response = await fetch(eventUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${getAuth()}`,
          },
        });

        if (!response.ok && response.status !== 204) {
          const text = await response.text();
          throw new Error(
            `CalDAV DELETE failed (HTTP ${response.status}): ${text}`
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, deleted: event_id },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
