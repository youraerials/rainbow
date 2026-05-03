/**
 * Rainbow web tier.
 *
 * Boots in one of two modes:
 *   - Normal mode (default): full stack — OIDC, dashboard, /apps, /mcp,
 *     all the admin APIs that depend on Authentik + Postgres being up.
 *   - Setup mode (RAINBOW_SETUP_MODE=1): pre-Authentik bootstrap. Skips
 *     OIDC entirely (chicken-and-egg — Authentik isn't running yet),
 *     mounts only `/api/setup/*` + `/api/mode`, and serves the dashboard
 *     SPA which detects mode via `/api/mode` and renders the wizard
 *     instead of the normal app shell.
 *
 * Setup mode runs out of a separate `rainbow-setup` container during
 * first-run install; the .pkg's postinstall script starts it bound to
 * 127.0.0.1 only and points the user's browser at it. Once provisioning
 * succeeds, it shuts itself down and the orchestrator brings up the real
 * stack in normal mode.
 */

import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";

import { apiRouter } from "./api/index.js";
import { attachMcp } from "./mcp/server.js";
import { configureOidc } from "./auth/oidc.js";
import { requireAuth } from "./auth/middleware.js";
import { migrate } from "./db/migrate.js";
import { isConfigured as dbConfigured } from "./db/pool.js";
import { setupRouter } from "./setup/router.js";

const PORT = Number(process.env.PORT ?? 3000);
const DASHBOARD_DIR = process.env.RAINBOW_DASHBOARD_DIR ?? "/usr/share/web/dashboard";
const APPS_DIR = process.env.RAINBOW_APPS_DIR ?? "/var/lib/rainbow/apps";

const SETUP_MODE = process.env.RAINBOW_SETUP_MODE === "1";

// ─── Common app setup ────────────────────────────────────────────
const app = express();
app.set("trust proxy", true);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

// /api/mode is public in both modes — the SPA hits it before deciding
// which top-level component (dashboard vs setup wizard) to render.
app.get("/api/mode", (_req, res) => {
    res.json({
        mode: SETUP_MODE ? "setup" : "dashboard",
        version: "0.1.0",
    });
});

if (SETUP_MODE) {
    // ─── Setup mode boot ─────────────────────────────────────────
    console.log("[rainbow-web] booting in SETUP MODE");
    app.use("/api/setup", setupRouter);

    // SPA + fallback. Wizard is a separate top-level React component in
    // the same bundle.
    app.use(express.static(DASHBOARD_DIR, { index: "index.html" }));
    app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (req.path.startsWith("/api/")) return next();
        res.sendFile(path.join(DASHBOARD_DIR, "index.html"));
    });

    app.listen(PORT, () => {
        console.log(`[rainbow-web] setup mode listening on :${PORT}`);
        console.log(`[rainbow-web]   dashboard: ${DASHBOARD_DIR}`);
    });
} else {
    // ─── Normal mode boot ────────────────────────────────────────
    const HOST_PREFIX = process.env.RAINBOW_HOST_PREFIX ?? "";
    const ZONE = process.env.RAINBOW_ZONE ?? "";
    const WEB_HOST =
        process.env.RAINBOW_WEB_HOST ??
        (HOST_PREFIX ? `${HOST_PREFIX.replace(/-$/, "")}.${ZONE}` : ZONE);
    const CLIENT_ID = process.env.RAINBOW_OAUTH_CLIENT_ID ?? "";
    const CLIENT_SECRET = process.env.RAINBOW_OAUTH_CLIENT_SECRET ?? "";
    const ISSUER =
        process.env.RAINBOW_OAUTH_ISSUER ??
        (ZONE ? `https://${HOST_PREFIX}auth.${ZONE}/application/o/web/` : "");
    const REDIRECT_URI =
        process.env.RAINBOW_OAUTH_REDIRECT_URI ??
        (WEB_HOST ? `https://${WEB_HOST}/api/auth/callback` : "");

    if (!CLIENT_ID || !CLIENT_SECRET || !ISSUER || !REDIRECT_URI) {
        console.error("[rainbow-web] FATAL: OIDC env not fully populated.");
        console.error("  RAINBOW_OAUTH_CLIENT_ID / _CLIENT_SECRET must be set,");
        console.error("  along with RAINBOW_HOST_PREFIX + RAINBOW_ZONE (or RAINBOW_OAUTH_ISSUER explicitly).");
        process.exit(1);
    }

    await configureOidc({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI,
    });

    if (dbConfigured()) {
        try {
            await migrate();
        } catch (err) {
            console.error("[rainbow-web] DB migrations failed — continuing without DB:", err);
        }
    } else {
        console.warn("[rainbow-web] POSTGRES_HOST/POSTGRES_PASSWORD not set — DB-backed features disabled");
    }

    app.use("/api", apiRouter);
    attachMcp(app, "/mcp", requireAuth);
    app.use("/apps", requireAuth, express.static(APPS_DIR, { index: "index.html" }));

    app.use((req, res, next) => {
        if (req.path.startsWith("/api/") || req.path.startsWith("/mcp")) return next();
        const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies;
        if (cookies?.rainbow_session) return next();
        res.redirect("/api/auth/login");
    });

    app.use(express.static(DASHBOARD_DIR, { index: "index.html" }));
    app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (req.path.startsWith("/api/") || req.path.startsWith("/mcp")) return next();
        res.sendFile(path.join(DASHBOARD_DIR, "index.html"));
    });

    app.listen(PORT, () => {
        console.log(`[rainbow-web] listening on :${PORT}`);
        console.log(`[rainbow-web]   dashboard: ${DASHBOARD_DIR}`);
        console.log(`[rainbow-web]   apps:      ${APPS_DIR}`);
    });
}
