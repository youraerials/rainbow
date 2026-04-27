/**
 * calendar resource — exposes upcoming calendar events as an MCP resource.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

function toICalDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace("Z", "") + "Z";
}

export function registerCalendarResource(server: McpServer): void {
  server.resource(
    "calendar",
    "calendar://events/upcoming",
    {
      description: "Upcoming calendar events for the next 30 days",
      mimeType: "application/json",
    },
    async () => {
      try {
        const calUrl = getCalendarUrl();
        const now = new Date();
        const thirtyDays = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000
        );

        const startStr = toICalDate(now.toISOString());
        const endStr = toICalDate(thirtyDays.toISOString());

        const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startStr}" end="${endStr}"/>
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

        // Parse VEVENT blocks from the CalDAV multi-status response
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

        // Sort by start date
        events.sort((a, b) => a.start.localeCompare(b.start));

        return {
          contents: [
            {
              uri: "calendar://events/upcoming",
              mimeType: "application/json",
              text: JSON.stringify(
                { count: events.length, events },
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
          contents: [
            {
              uri: "calendar://events/upcoming",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    }
  );
}
