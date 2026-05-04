/**
 * Thin CalDAV client for Stalwart. CalDAV is WebDAV with a `calendar-data`
 * namespace on top — request bodies and responses are XML, calendar
 * objects themselves are iCalendar (RFC 5545).
 *
 * Auth + URL resolution: same Basic creds as JMAP, served at
 * /dav/cal/ on the mail subdomain. STALWART_JMAP_USER + _PASSWORD are
 * the same JMAP credentials we use for the email tools.
 *
 * We deliberately avoid pulling in a full WebDAV library — our needs
 * are tiny (PROPFIND for calendars, REPORT for events, PUT for create).
 * String-templated XML is fine and stays auditable.
 */

import { publicUrl } from "../../../services/registry.js";

const USER = process.env.STALWART_JMAP_USER ?? "";
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? "";

export function isConfigured(): boolean {
    return Boolean(USER && PASSWORD);
}

function authHeader(): string {
    return "Basic " + Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
}

function principalRoot(): string {
    // Stalwart's CalDAV principal collection. The ${USER} segment is the
    // user's bare username (no @domain) — Stalwart maps that to the
    // authenticated user's principal.
    return publicUrl("mail", `/dav/cal/${encodeURIComponent(userBare())}/`);
}

function userBare(): string {
    return USER.includes("@") ? USER.split("@")[0] : USER;
}

export function calDavBase(): string {
    return publicUrl("mail", "/dav/cal/");
}

/**
 * One CalDAV request. Returns the raw response text — callers parse
 * either iCal (for VEVENTs) or the multistatus XML (for collections)
 * with simple regex extraction.
 */
export async function caldav(
    method: string,
    pathOrUrl: string,
    options: {
        body?: string;
        depth?: "0" | "1" | "infinity";
        contentType?: string;
        ifMatch?: string;
        timeoutMs?: number;
    } = {},
): Promise<{ ok: boolean; status: number; text: string; headers: Headers }> {
    const url = pathOrUrl.startsWith("http")
        ? pathOrUrl
        : publicUrl("mail", pathOrUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
        const headers: Record<string, string> = {
            Authorization: authHeader(),
            ...(options.depth ? { Depth: options.depth } : {}),
            ...(options.contentType ? { "Content-Type": options.contentType } : {}),
            ...(options.ifMatch ? { "If-Match": options.ifMatch } : {}),
        };
        const resp = await fetch(url, {
            method,
            headers,
            body: options.body,
            signal: controller.signal,
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, text, headers: resp.headers };
    } finally {
        clearTimeout(timer);
    }
}

export async function listCalendarHrefs(): Promise<Array<{ href: string; displayName: string }>> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;
    const r = await caldav("PROPFIND", principalRoot(), {
        body,
        depth: "1",
        contentType: 'application/xml; charset="utf-8"',
    });
    if (!r.ok) {
        throw new Error(`CalDAV PROPFIND failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
    }
    return parseCalendarCollections(r.text);
}

/**
 * Pull <response> blocks out of a multistatus reply where resourcetype
 * contains <calendar/>. We use bracket-counting rather than a real XML
 * parser because Stalwart's responses are well-formed and small.
 */
function parseCalendarCollections(xml: string): Array<{ href: string; displayName: string }> {
    const out: Array<{ href: string; displayName: string }> = [];
    const respRe = /<(?:[a-z]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?response>/gi;
    let m: RegExpExecArray | null;
    while ((m = respRe.exec(xml)) !== null) {
        const block = m[1];
        if (!/<(?:[a-z]+:)?calendar\b/i.test(block)) continue;
        const href = (block.match(/<(?:[a-z]+:)?href[^>]*>([^<]+)<\/(?:[a-z]+:)?href>/i) || [])[1];
        const name =
            (block.match(/<(?:[a-z]+:)?displayname[^>]*>([^<]*)<\/(?:[a-z]+:)?displayname>/i) || [])[1] ?? "";
        if (href) out.push({ href: href.trim(), displayName: name.trim() });
    }
    return out;
}

/**
 * Parse <response> blocks containing a calendar-data CDATA payload (an
 * iCalendar VEVENT). Returns one entry per event with the raw iCal.
 */
export function parseEventResponses(xml: string): Array<{ href: string; etag: string; ical: string }> {
    const out: Array<{ href: string; etag: string; ical: string }> = [];
    const respRe = /<(?:[a-z]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?response>/gi;
    let m: RegExpExecArray | null;
    while ((m = respRe.exec(xml)) !== null) {
        const block = m[1];
        const href = (block.match(/<(?:[a-z]+:)?href[^>]*>([^<]+)<\/(?:[a-z]+:)?href>/i) || [])[1] ?? "";
        const etag = (block.match(/<(?:[a-z]+:)?getetag[^>]*>([^<]*)<\/(?:[a-z]+:)?getetag>/i) || [])[1] ?? "";
        const ical = (block.match(/<(?:[a-z]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?calendar-data>/i) || [])[1] ?? "";
        if (ical.trim()) {
            out.push({
                href: href.trim(),
                etag: etag.trim().replace(/^"(.*)"$/, "$1"),
                ical: decodeXmlEntities(ical),
            });
        }
    }
    return out;
}

function decodeXmlEntities(s: string): string {
    return s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/** Extract VEVENT properties as a flat object. Handles folded lines (RFC 5545 §3.1). */
export function parseICalEvent(ical: string): Record<string, string> {
    // Unfold continuation lines: any CRLF + whitespace becomes "".
    const text = ical.replace(/\r?\n[ \t]/g, "");
    const props: Record<string, string> = {};
    const lines = text.split(/\r?\n/);
    let inEvent = false;
    for (const line of lines) {
        if (line === "BEGIN:VEVENT") {
            inEvent = true;
            continue;
        }
        if (line === "END:VEVENT") break;
        if (!inEvent) continue;
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const lhs = line.slice(0, colon);
        const value = line.slice(colon + 1);
        const semi = lhs.indexOf(";");
        const name = (semi < 0 ? lhs : lhs.slice(0, semi)).toUpperCase();
        // Last-write-wins for repeated props is fine for our needs.
        props[name] = value;
    }
    return props;
}
