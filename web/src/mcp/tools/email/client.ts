/**
 * Thin JMAP client for Stalwart. JMAP is RPC-over-JSON, so a single helper
 * (`jmap()`) suffices: it resolves the session, picks the API URL + accountId,
 * and submits one or more method calls.
 *
 * Auth: Basic with STALWART_JMAP_USER + STALWART_JMAP_PASSWORD. These are
 * provisioned by the user (see services/stalwart/README.md) into macOS
 * Keychain and injected into the rainbow-web container by the orchestrator.
 *
 * If either env var is missing, isConfigured() returns false and the email
 * tools refuse to register.
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

interface JmapSession {
    apiUrl: string;
    uploadUrl?: string;
    primaryAccounts?: Record<string, string>;
}

let cachedSession: JmapSession | null = null;
let cachedAccountId: string | null = null;
let cachedInboxId: string | null = null;

async function fetchSession(): Promise<JmapSession> {
    if (cachedSession) return cachedSession;
    const url = publicUrl("mail", "/.well-known/jmap");
    const resp = await fetch(url, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!resp.ok) {
        throw new Error(`JMAP session fetch failed: HTTP ${resp.status}`);
    }
    const session = (await resp.json()) as JmapSession;
    cachedSession = session;
    return session;
}

export async function accountId(): Promise<string> {
    if (cachedAccountId) return cachedAccountId;
    const session = await fetchSession();
    const id =
        session.primaryAccounts?.["urn:ietf:params:jmap:mail"] ??
        Object.values(session.primaryAccounts ?? {})[0];
    if (!id) throw new Error("no JMAP mail account in session");
    cachedAccountId = id;
    return id;
}

// One JMAP method call: [name, args, callId]
export type JmapCall = [string, Record<string, unknown>, string];

interface JmapResponse {
    methodResponses: JmapCall[];
}

export interface JmapResult<T> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

// Look up the Inbox mailbox ID, cached after the first call. Used by the
// inbound-mail endpoint to know where to deposit incoming RFC822 messages.
export async function getInboxId(): Promise<string> {
    if (cachedInboxId) return cachedInboxId;
    const acct = await accountId();
    const resp = await jmap<{
        methodResponses: Array<
            ["Mailbox/get", { list?: Array<{ id: string; role?: string }> }, string]
        >;
    }>([
        [
            "Mailbox/get",
            { accountId: acct, properties: ["id", "role"] },
            "0",
        ],
    ]);
    if (!resp.ok || !resp.data) {
        throw new Error(`Mailbox/get failed: ${resp.error ?? "unknown"}`);
    }
    const list = resp.data.methodResponses[0]?.[1]?.list ?? [];
    const inbox = list.find((m) => m.role === "inbox");
    if (!inbox) throw new Error("no Inbox mailbox found in account");
    cachedInboxId = inbox.id;
    return inbox.id;
}

// Upload a raw message blob to JMAP and return its blobId. Step 1 of
// importing an inbound RFC822 message.
async function uploadBlob(
    body: Buffer | Uint8Array,
    contentType = "message/rfc822",
): Promise<string> {
    const session = await fetchSession();
    if (!session.uploadUrl) {
        throw new Error("JMAP session has no uploadUrl");
    }
    const acct = await accountId();
    const url = session.uploadUrl.replace("{accountId}", acct);
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: authHeader(),
            "Content-Type": contentType,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: body as any,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Blob upload failed: HTTP ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as { blobId: string };
    return data.blobId;
}

// Import a raw RFC822 message into the user's Inbox. Used by the
// /api/inbound-mail endpoint after Cloudflare's Email Worker hands us a
// message that arrived at our domain's MX. Returns the imported message's
// JMAP id.
export async function importEmail(
    rfc822: Buffer | Uint8Array,
    receivedAt = new Date().toISOString(),
): Promise<string> {
    const blobId = await uploadBlob(rfc822);
    const acct = await accountId();
    const inboxId = await getInboxId();
    const resp = await jmap<{
        methodResponses: Array<
            [
                "Email/import",
                {
                    created?: Record<string, { id: string }>;
                    notCreated?: Record<string, { type: string; description?: string }>;
                },
                string,
            ]
        >;
    }>([
        [
            "Email/import",
            {
                accountId: acct,
                emails: {
                    inbound: {
                        blobId,
                        mailboxIds: { [inboxId]: true },
                        keywords: { $seen: false },
                        receivedAt,
                    },
                },
            },
            "0",
        ],
    ]);
    if (!resp.ok || !resp.data) {
        throw new Error(`Email/import failed: ${resp.error ?? "unknown"}`);
    }
    const result = resp.data.methodResponses[0]?.[1];
    if (result?.notCreated?.inbound) {
        const err = result.notCreated.inbound;
        throw new Error(
            `Email/import rejected: ${err.type}${err.description ? ` — ${err.description}` : ""}`,
        );
    }
    const id = result?.created?.inbound?.id;
    if (!id) throw new Error("Email/import returned no id");
    return id;
}

export async function jmap<T = unknown>(
    methodCalls: JmapCall[],
    timeoutMs = 10000,
): Promise<JmapResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const session = await fetchSession();
        const body = {
            using: [
                "urn:ietf:params:jmap:core",
                "urn:ietf:params:jmap:mail",
                "urn:ietf:params:jmap:submission",
            ],
            methodCalls,
        };
        const resp = await fetch(session.apiUrl, {
            method: "POST",
            headers: {
                Authorization: authHeader(),
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await resp.text();
        if (!resp.ok) {
            return { ok: false, status: resp.status, error: text };
        }
        const parsed = JSON.parse(text) as JmapResponse;
        return { ok: true, status: resp.status, data: parsed as unknown as T };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(timer);
    }
}
