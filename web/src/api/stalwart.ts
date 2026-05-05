/**
 * /api/admin/stalwart/* — connect a Stalwart JMAP account so the
 * email/calendar/contacts MCP tools can authenticate.
 *
 * The web tier reads STALWART_JMAP_USER/PASSWORD from its env at boot;
 * those env vars come from Keychain (rainbow-stalwart-jmap-user /
 * -password) at orchestrator run-time. After Stalwart's first-run
 * web wizard, those Keychain entries are still empty — this endpoint
 * lets the user populate them from the dashboard:
 *
 *   1. Validate the supplied creds against Stalwart's JMAP session
 *      endpoint (Basic auth — same auth the MCP tools use).
 *   2. Write both Keychain entries via the host control daemon.
 *   3. Restart rainbow-web so the new env vars take effect.
 *
 * The user comes back to a working email tile + freshly-registered
 * email/calendar/contacts MCP tools.
 */

import { Router, Request, Response } from "express";
import { publicUrl } from "../services/registry.js";
import { keychainPut, restart, isConfigured as controlConfigured } from "../services/control.js";

export const stalwartRouter = Router();

const KC_USER = "rainbow-stalwart-jmap-user";
const KC_PASSWORD = "rainbow-stalwart-jmap-password";

stalwartRouter.get("/status", (_req: Request, res: Response) => {
    const user = process.env.STALWART_JMAP_USER ?? "";
    const password = process.env.STALWART_JMAP_PASSWORD ?? "";
    res.json({
        connected: Boolean(user && password),
        user: user || null,
    });
});

stalwartRouter.post("/connect", async (req: Request, res: Response) => {
    const body = req.body as { user?: unknown; password?: unknown } | undefined;
    const user = typeof body?.user === "string" ? body.user.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!user || !password) {
        res.status(400).json({ error: "missing 'user' or 'password'" });
        return;
    }
    if (!controlConfigured()) {
        res.status(503).json({
            error: "host control daemon not reachable — can't write Keychain from web tier",
        });
        return;
    }

    // Validate by hitting Stalwart's JMAP session URL. Anything but 200
    // means the creds don't work — refuse to store them.
    const sessionUrl = publicUrl("mail", "/.well-known/jmap");
    const auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
    let probe: globalThis.Response;
    try {
        probe = await fetch(sessionUrl, {
            headers: { Authorization: auth, Accept: "application/json" },
        });
    } catch (err) {
        res.status(502).json({
            error: `couldn't reach Stalwart at ${sessionUrl}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        });
        return;
    }
    if (probe.status === 401 || probe.status === 403) {
        res.status(401).json({
            error: "Stalwart rejected those credentials. Double-check the JMAP login created during Stalwart setup.",
        });
        return;
    }
    if (!probe.ok) {
        res.status(502).json({
            error: `Stalwart returned HTTP ${probe.status} — try again, or check Stalwart logs.`,
        });
        return;
    }

    // Creds work. Push to Keychain via control daemon.
    const userPut = await keychainPut(KC_USER, user);
    if (userPut.status >= 300) {
        res.status(500).json({ error: "control daemon refused user write", detail: userPut.body });
        return;
    }
    const passPut = await keychainPut(KC_PASSWORD, password);
    if (passPut.status >= 300) {
        res.status(500).json({ error: "control daemon refused password write", detail: passPut.body });
        return;
    }

    // Recreate rainbow-web so it picks up the new env. The control
    // daemon's restart action delegates to orchestrator.sh restart-container,
    // which re-reads Keychain and recompiles Caddy. Fire-and-forget — by
    // the time it completes, this very request has long since returned.
    void restart("rainbow-web").catch(() => {
        /* logged inside restart(); user sees "connected" + a brief blip */
    });

    res.json({ ok: true, user, restarting: true });
});
