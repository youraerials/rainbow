/**
 * Rainbow Email Receiver — Cloudflare Email Worker
 *
 * Triggered by Cloudflare Email Routing whenever mail arrives at any address
 * under the configured domain (set up via the Cloudflare dashboard: Email →
 * Email Routing → Email Workers).
 *
 * For each message we:
 *   1. Read the raw RFC822 stream into a buffer.
 *   2. HMAC-sign the body with RAINBOW_INBOUND_MAIL_SECRET (shared with the
 *      web tier's /api/inbound-mail handler).
 *   3. POST the body to the tunnel: https://<RAINBOW_DOMAIN>/api/inbound-mail
 *   4. On 2xx, the message is durable in Stalwart's Inbox; we're done.
 *      On error, we let the Worker throw so Cloudflare requeues the message —
 *      Email Workers retry transient failures automatically.
 *
 * Configuration (set via `wrangler secret put` and wrangler.toml [vars]):
 *   - INBOUND_MAIL_SECRET   — same value as `rainbow-inbound-mail-secret` in
 *                             host Keychain (Worker secret)
 *   - INBOUND_MAIL_URL      — full URL of the web tier endpoint, e.g.
 *                             https://test.rainbow.rocks/api/inbound-mail
 *                             (plain var, set in wrangler.toml or dashboard)
 */

interface Env {
    INBOUND_MAIL_SECRET: string;
    INBOUND_MAIL_URL: string;
}

async function readToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            total += value.length;
        }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

async function hmacHex(secret: string, body: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, body);
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export default {
    async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
        if (!env.INBOUND_MAIL_SECRET || !env.INBOUND_MAIL_URL) {
            console.error("[email-receiver] missing config; rejecting");
            message.setReject("Mail server is not configured");
            return;
        }

        const body = await readToBuffer(message.raw);
        const sig = await hmacHex(env.INBOUND_MAIL_SECRET, body);

        const resp = await fetch(env.INBOUND_MAIL_URL, {
            method: "POST",
            headers: {
                "Content-Type": "message/rfc822",
                "X-Rainbow-Inbound-Signature": `sha256=${sig}`,
                "X-Rainbow-Inbound-From": message.from,
                "X-Rainbow-Inbound-To": message.to,
            },
            body,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            console.error(
                `[email-receiver] backend rejected (HTTP ${resp.status}): ${text}`,
            );
            // Throwing causes Email Routing to retry; don't reject the
            // message outright (which would NDR back to the sender) for
            // transient backend issues.
            throw new Error(`backend HTTP ${resp.status}`);
        }
    },
};
