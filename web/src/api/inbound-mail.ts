/**
 * /api/inbound-mail — receives RFC822 messages forwarded from the Cloudflare
 * Email Worker and imports them into Stalwart's Inbox.
 *
 * Public route (no OIDC session) — Cloudflare Workers can't carry our cookie.
 * Authenticated via HMAC-SHA256 over the body using a shared secret stored in
 * macOS Keychain (`rainbow-inbound-mail-secret`) and as a Worker secret.
 *
 * Body: raw RFC822 bytes (Content-Type: message/rfc822).
 * Header: X-Rainbow-Inbound-Signature: sha256=<hex>
 *
 * Phase 1: every accepted message lands in the configured JMAP user's Inbox.
 * Multi-user routing (looking at the To: header and picking a mailbox per
 * account) comes when Rainbow grows beyond single-user.
 */

import { Router, Request, Response } from "express";
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { importEmail, isConfigured } from "../mcp/tools/email/client.js";

export const inboundMailRouter = Router();

const SECRET = process.env.RAINBOW_INBOUND_MAIL_SECRET ?? "";

function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!SECRET || !header) return false;
    const expected = "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

// Capture raw bytes; we need them both for signature verification and for the
// JMAP blob upload. express.raw gives us a Buffer at req.body.
inboundMailRouter.post(
    "/",
    express.raw({ type: "*/*", limit: "25mb" }),
    async (req: Request, res: Response) => {
        if (!SECRET) {
            res.status(503).json({
                error: "RAINBOW_INBOUND_MAIL_SECRET not configured on server",
            });
            return;
        }
        if (!isConfigured()) {
            res.status(503).json({
                error: "Stalwart JMAP credentials not configured — see services/stalwart/README.md",
            });
            return;
        }
        const sig =
            typeof req.headers["x-rainbow-inbound-signature"] === "string"
                ? req.headers["x-rainbow-inbound-signature"]
                : undefined;
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length === 0) {
            res.status(400).json({ error: "empty body" });
            return;
        }
        if (!verifySignature(body, sig)) {
            res.status(401).json({ error: "invalid or missing signature" });
            return;
        }
        try {
            const id = await importEmail(body);
            res.status(200).json({ ok: true, id });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[inbound-mail] import failed:", message);
            res.status(502).json({ ok: false, error: message });
        }
    },
);
