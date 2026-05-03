/**
 * /api/admin/smarthost — CRUD + test for the outbound SMTP relay config.
 *
 * Auth-required (mounted under the requireAuth section of /api). The full
 * password is never returned over GET; we surface just a 4-char tail so the
 * dashboard can confirm "yes, this is configured" without exposing the
 * secret.
 */

import { Router, Request, Response } from "express";
import { isConfigured as dbConfigured } from "../db/pool.js";
import {
    SmarthostConfig,
    SmarthostProvider,
    SmarthostSecurity,
    getConfig,
    getStatus,
    saveConfig,
    clearConfig,
    send,
} from "../services/smarthost.js";

export const smarthostRouter = Router();

const PROVIDERS: SmarthostProvider[] = [
    "resend",
    "postmark",
    "ses",
    "mailgun",
    "smtp",
];
const SECURITIES: SmarthostSecurity[] = ["tls", "starttls", "none"];

function requireDb(_req: Request, res: Response, next: () => void): void {
    if (!dbConfigured()) {
        res.status(503).json({ error: "database not configured" });
        return;
    }
    next();
}

smarthostRouter.get("/", requireDb, async (_req, res) => {
    res.json(await getStatus());
});

smarthostRouter.put("/", requireDb, async (req, res) => {
    const body = req.body as Partial<SmarthostConfig>;
    if (
        !body.provider ||
        !PROVIDERS.includes(body.provider) ||
        !body.host ||
        typeof body.port !== "number" ||
        !body.security ||
        !SECURITIES.includes(body.security) ||
        !body.username ||
        !body.password ||
        !body.fromAddress
    ) {
        res.status(400).json({
            error:
                "missing or invalid fields. Required: provider, host, port (number), security (tls|starttls|none), username, password, fromAddress",
        });
        return;
    }
    try {
        await saveConfig(body as SmarthostConfig);
        res.json({ ok: true, ...(await getStatus()) });
    } catch (err) {
        res.status(400).json({
            error: err instanceof Error ? err.message : String(err),
        });
    }
});

smarthostRouter.delete("/", requireDb, async (_req, res) => {
    await clearConfig();
    res.json({ ok: true });
});

// Send a one-off test message using the *currently saved* config. By
// default the message goes to the authenticated user's email, so the
// dashboard's "Send test" button is a complete round-trip with no extra
// input. The body can override the recipient for ad-hoc testing.
smarthostRouter.post("/test", requireDb, async (req: Request, res: Response) => {
    const cfg = await getConfig();
    if (!cfg) {
        res.status(400).json({ error: "no smarthost configured" });
        return;
    }
    const body = (req.body ?? {}) as { to?: string };
    const to = body.to ?? req.user?.email;
    if (!to) {
        res.status(400).json({
            error: "no recipient — pass `to` or sign in with an email-bearing identity",
        });
        return;
    }
    const result = await send(cfg, {
        to,
        subject: "Rainbow smarthost test",
        text:
            "If you can see this, your outbound mail config works.\n\n" +
            `Provider: ${cfg.provider}\n` +
            `Host:     ${cfg.host}:${cfg.port} (${cfg.security})\n` +
            `From:     ${cfg.fromAddress}\n`,
    });
    res.status(result.ok ? 200 : 502).json(result);
});
