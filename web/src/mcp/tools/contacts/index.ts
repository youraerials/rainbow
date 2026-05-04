/**
 * Contacts tools — Stalwart CardDAV. Mirrors the calendar/* layout:
 * single client.ts wrapping minimal WebDAV REPORTs over the user's
 * principal collection. Same Basic auth (STALWART_JMAP_USER + _PASSWORD)
 * as the email + calendar tools.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { publicUrl } from "../../../services/registry.js";

const USER = process.env.STALWART_JMAP_USER ?? "";
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? "";

function isConfigured(): boolean {
    return Boolean(USER && PASSWORD);
}

function authHeader(): string {
    return "Basic " + Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
}

function userBare(): string {
    return USER.includes("@") ? USER.split("@")[0] : USER;
}

function principalRoot(): string {
    return publicUrl("mail", `/dav/card/${encodeURIComponent(userBare())}/`);
}

async function carddav(
    method: string,
    path: string,
    options: { body?: string; depth?: "0" | "1" | "infinity"; contentType?: string } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
    const url = path.startsWith("http") ? path : publicUrl("mail", path);
    const headers: Record<string, string> = {
        Authorization: authHeader(),
        ...(options.depth ? { Depth: options.depth } : {}),
        ...(options.contentType ? { "Content-Type": options.contentType } : {}),
    };
    const resp = await fetch(url, {
        method,
        headers,
        body: options.body,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
}

/** Pull all <response>'s with non-empty <address-data> and parse as vCard. */
function parseAddressBookResponses(xml: string): Array<{ href: string; vcard: string }> {
    const out: Array<{ href: string; vcard: string }> = [];
    const respRe = /<(?:[a-z]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?response>/gi;
    let m: RegExpExecArray | null;
    while ((m = respRe.exec(xml)) !== null) {
        const block = m[1];
        const href = (block.match(/<(?:[a-z]+:)?href[^>]*>([^<]+)<\/(?:[a-z]+:)?href>/i) || [])[1] ?? "";
        const data = (block.match(/<(?:[a-z]+:)?address-data[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?address-data>/i) || [])[1] ?? "";
        if (data.trim()) out.push({ href: href.trim(), vcard: decodeXml(data) });
    }
    return out;
}

function decodeXml(s: string): string {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

interface Contact {
    href: string;
    full_name?: string;
    email?: string[];
    phone?: string[];
    org?: string;
    title?: string;
}

function parseVCard(href: string, vcard: string): Contact {
    // Unfold continuation lines first (RFC 6350 §3.2).
    const text = vcard.replace(/\r?\n[ \t]/g, "");
    const out: Contact = { href, email: [], phone: [] };
    for (const line of text.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const lhs = line.slice(0, colon);
        const value = line.slice(colon + 1);
        const semi = lhs.indexOf(";");
        const name = (semi < 0 ? lhs : lhs.slice(0, semi)).toUpperCase();
        switch (name) {
            case "FN":
                out.full_name = value;
                break;
            case "EMAIL":
                out.email!.push(value);
                break;
            case "TEL":
                out.phone!.push(value);
                break;
            case "ORG":
                out.org = value.replace(/;$/, "");
                break;
            case "TITLE":
                out.title = value;
                break;
        }
    }
    if (out.email && out.email.length === 0) delete out.email;
    if (out.phone && out.phone.length === 0) delete out.phone;
    return out;
}

async function fetchAllContacts(): Promise<Contact[]> {
    // First find the addressbook collection(s) under the principal,
    // then REPORT addressbook-query against each.
    const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cb="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;
    const root = await carddav("PROPFIND", principalRoot(), {
        body: propfindBody,
        depth: "1",
        contentType: 'application/xml; charset="utf-8"',
    });
    if (!root.ok) {
        throw new Error(`CardDAV PROPFIND failed: HTTP ${root.status}`);
    }
    const respRe = /<(?:[a-z]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?response>/gi;
    const books: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = respRe.exec(root.text)) !== null) {
        const block = m[1];
        if (!/<(?:[a-z]+:)?addressbook\b/i.test(block)) continue;
        const href = (block.match(/<(?:[a-z]+:)?href[^>]*>([^<]+)<\/(?:[a-z]+:)?href>/i) || [])[1];
        if (href) books.push(href.trim());
    }
    const queryBody = `<?xml version="1.0" encoding="utf-8" ?>
<cb:addressbook-query xmlns:d="DAV:" xmlns:cb="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <cb:address-data/>
  </d:prop>
</cb:addressbook-query>`;
    const all: Contact[] = [];
    for (const book of books) {
        const r = await carddav("REPORT", book, {
            body: queryBody,
            depth: "1",
            contentType: 'application/xml; charset="utf-8"',
        });
        if (!r.ok) continue;
        for (const { href, vcard } of parseAddressBookResponses(r.text)) {
            all.push(parseVCard(href, vcard));
        }
    }
    return all;
}

export function registerContactsTools(server: McpServer): void {
    if (!isConfigured()) {
        console.warn(
            "[mcp/contacts] STALWART_JMAP_USER/PASSWORD not set — contact tools disabled.",
        );
        return;
    }

    server.tool(
        "contacts.list",
        "List the user's contacts across all CardDAV addressbooks.",
        {
            limit: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                .describe("Max contacts to return (default 100)"),
        },
        async ({ limit }) => {
            try {
                const contacts = await fetchAllContacts();
                const cap = limit ?? 100;
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    count: Math.min(contacts.length, cap),
                                    total: contacts.length,
                                    contacts: contacts.slice(0, cap),
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

    server.tool(
        "contacts.search",
        "Search contacts by case-insensitive substring match against name, email, organization, or phone.",
        {
            query: z.string().min(1).describe("Substring to match"),
            limit: z
                .number()
                .int()
                .positive()
                .max(100)
                .optional()
                .describe("Max results (default 25)"),
        },
        async ({ query, limit }) => {
            try {
                const all = await fetchAllContacts();
                const q = query.toLowerCase();
                const matches = all.filter((c) => {
                    if (c.full_name?.toLowerCase().includes(q)) return true;
                    if (c.org?.toLowerCase().includes(q)) return true;
                    if (c.email?.some((e) => e.toLowerCase().includes(q))) return true;
                    if (c.phone?.some((p) => p.toLowerCase().includes(q))) return true;
                    return false;
                });
                const cap = limit ?? 25;
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    count: Math.min(matches.length, cap),
                                    total: matches.length,
                                    results: matches.slice(0, cap),
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
