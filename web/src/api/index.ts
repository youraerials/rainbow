/**
 * Admin REST API. /api/auth/* is unprotected (it's the login flow itself);
 * everything else requires a valid OIDC session cookie or Bearer token.
 */

import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { authRouter } from "./auth.js";
import { statusRouter } from "./status.js";
import { adminRouter } from "./admin.js";
import { appsRouter } from "./apps.js";
import { servicesControlRouter } from "./services-control.js";
import { inboundMailRouter } from "./inbound-mail.js";
import { smarthostRouter } from "./smarthost.js";
import { updatesRouter } from "./updates.js";
import { listTools, callTool } from "../mcp/server.js";

export const apiRouter = Router();

// Auth routes are public — they're how you become authenticated.
apiRouter.use("/auth", authRouter);

// Inbound mail webhook is public but HMAC-protected (called by the Cloudflare
// Email Worker, which can't carry our OIDC session cookie).
apiRouter.use("/inbound-mail", inboundMailRouter);

// Everything below this point requires authentication.
apiRouter.use(requireAuth);

apiRouter.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "rainbow-web",
        timestamp: new Date().toISOString(),
        user: req.user
            ? {
                  sub: req.user.sub,
                  email: req.user.email,
                  name: req.user.name,
              }
            : null,
    });
});

// /api/status, /api/services — service catalog + live health.
apiRouter.use(statusRouter);

// /api/services/:slug/{restart,start,stop,logs} — proxies to host control daemon.
apiRouter.use(servicesControlRouter);

// /api/admin/* — admin config (Anthropic key, etc.)
apiRouter.use("/admin", adminRouter);

// /api/admin/smarthost — outbound SMTP relay configuration
apiRouter.use("/admin/smarthost", smarthostRouter);

// /api/apps/* — list, get, delete apps + per-app key/value data
apiRouter.use("/apps", appsRouter);

// /api/updates/* — Rainbow self-update + Apple Container version delta
apiRouter.use("/updates", updatesRouter);

// /api/mcp/tools — read-only catalog of MCP tools the gateway exposes.
// Same data the app-generation prompt consumes; surfaced here for the
// dashboard's app builder to show users what's available before they
// describe an app.
apiRouter.get("/mcp/tools", (_req, res) => {
    const tools = listTools();
    res.json({ count: tools.length, tools });
});

// /api/mcp/call — debug helper that invokes a tool directly (no
// JSON-RPC dance). Used by the App Builder's "Try a tool" panel so a
// human can poke at any registered tool without writing curl by hand.
// Same auth gate as everything else; passes the authenticated user
// through so users.me reflects the caller.
apiRouter.post("/mcp/call", async (req, res) => {
    const body = req.body as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!body?.name || typeof body.name !== "string") {
        res.status(400).json({ error: "missing 'name'" });
        return;
    }
    const result = await callTool(body.name, body.arguments ?? {}, req.user);
    res.json(result);
});
