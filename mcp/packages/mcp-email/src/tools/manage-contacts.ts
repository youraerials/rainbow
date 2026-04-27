/**
 * Contact management tools — search and create contacts via CardDAV.
 *
 * Uses Stalwart's CardDAV endpoint at /dav to manage vCard contacts.
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

function getAddressBookUrl(): string {
  const user = process.env.STALWART_USER ?? "admin";
  return `${DAV_BASE}/addressbooks/user/${user}/default`;
}

function generateUid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function registerContactTools(server: McpServer): void {
  // ── search_contacts ───────────────────────────────────────────

  server.tool(
    "search_contacts",
    "Search contacts in the address book via CardDAV",
    {
      query: z.string().describe("Search query (matches name or email)"),
    },
    async ({ query }) => {
      try {
        const abUrl = getAddressBookUrl();

        // Use REPORT with addressbook-query to search contacts
        const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">${escapeXml(query)}</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

        const response = await fetch(abUrl, {
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
            `CardDAV REPORT failed (HTTP ${response.status}): ${text}`
          );
        }

        const xmlText = await response.text();

        // Parse vCard data from the response
        const contacts: Array<Record<string, string>> = [];
        const vcardBlocks = xmlText.split("BEGIN:VCARD");

        for (let i = 1; i < vcardBlocks.length; i++) {
          const block = vcardBlocks[i].split("END:VCARD")[0];
          const extract = (key: string): string => {
            const match = block.match(new RegExp(`${key}[^:]*:(.+)`));
            return match?.[1]?.trim() ?? "";
          };

          contacts.push({
            uid: extract("UID"),
            name: extract("FN"),
            email: extract("EMAIL"),
            phone: extract("TEL"),
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, count: contacts.length, contacts },
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

  // ── create_contact ────────────────────────────────────────────

  server.tool(
    "create_contact",
    "Create a new contact in the address book via CardDAV",
    {
      name: z.string().describe("Full name of the contact"),
      email: z.string().email().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
    },
    async ({ name, email, phone }) => {
      try {
        const uid = generateUid();
        const abUrl = getAddressBookUrl();
        const contactUrl = `${abUrl}/${uid}.vcf`;

        const vcardLines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `UID:${uid}`,
          `FN:${name}`,
          `EMAIL;TYPE=INTERNET:${email}`,
        ];

        if (phone) {
          vcardLines.push(`TEL;TYPE=CELL:${phone}`);
        }

        vcardLines.push(
          `REV:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
          "END:VCARD"
        );

        const vcard = vcardLines.join("\r\n");

        const response = await fetch(contactUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "text/vcard; charset=utf-8",
            Authorization: `Basic ${getAuth()}`,
            "If-None-Match": "*",
          },
          body: vcard,
        });

        if (!response.ok && response.status !== 201) {
          const text = await response.text();
          throw new Error(
            `CardDAV PUT failed (HTTP ${response.status}): ${text}`
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, contact_id: uid, name, email, phone },
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

/** Escapes special XML characters in text content. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
