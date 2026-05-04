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

// 47080 is uncommon (most local dev tooling clusters around :3000, :8080,
// :5000). Container-internal under Apple Container, but a less-trafficked
// number sidesteps host-side conflicts that surface as install hangs.
const PORT = Number(process.env.PORT ?? 47080);
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

    // The dashboard SPA is built with Vite `base: "/dashboard/"`, so its
    // index.html references `/dashboard/assets/...`. We mount the static
    // bundle at /dashboard so those URLs resolve, and also at / so the
    // wizard URL itself (http://<setup-ip>:port/) serves index.html.
    app.use("/dashboard", express.static(DASHBOARD_DIR, { index: "index.html" }));
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

    // Dashboard moves from / to /dashboard (so / is free for the user's
    // home app). Vite is built with `base: "/dashboard/"` so asset URLs
    // resolve correctly under this prefix; React Router uses the
    // matching basename.
    app.use(
        "/dashboard",
        (req, res, next) => {
            const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies;
            if (cookies?.rainbow_session) return next();
            res.redirect("/api/auth/login");
        },
        express.static(DASHBOARD_DIR, { index: "index.html" }),
        (req, res, next) => {
            if (req.method !== "GET") return next();
            res.sendFile(path.join(DASHBOARD_DIR, "index.html"));
        },
    );

    app.use("/apps", requireAuth, express.static(APPS_DIR, { index: "index.html" }));

    // Root: serve the user's home app (whichever is flagged is_home in
    // the apps table) at /. If no app is flagged, serve a small
    // placeholder pointing the visitor at the dashboard.
    const { getHomeAppSlug } = await import("./db/apps.js");
    const path_ = path;
    app.get("/", async (_req, res, next) => {
        const slug = await getHomeAppSlug().catch(() => null);
        if (!slug) return next(); // falls through to placeholder below
        const indexPath = path_.join(APPS_DIR, slug, "index.html");
        res.sendFile(indexPath, (err) => {
            if (err) next();
        });
    });
    app.use(async (req, res, next) => {
        if (req.method !== "GET") return next();
        if (req.path.startsWith("/api/") || req.path.startsWith("/mcp") ||
            req.path.startsWith("/dashboard") || req.path.startsWith("/apps")) {
            return next();
        }
        const slug = await getHomeAppSlug().catch(() => null);
        if (slug) {
            // Resolve `/foo.css` (etc.) against the home app's directory
            // — like express.static would, but only if a home is set.
            const target = path_.join(APPS_DIR, slug, req.path);
            const root = path_.join(APPS_DIR, slug);
            if (!target.startsWith(root + path_.sep) && target !== root) {
                return next();
            }
            res.sendFile(target, (err) => {
                if (err) next();
            });
            return;
        }
        next();
    });

    // Final fallback: visitor hits / (or anything not claimed above)
    // and no home app is set. Show a simple welcome page that points
    // at /dashboard. This is a string literal — no static file to ship.
    app.get("*", (_req, res) => {
        res.status(200).type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Rainbow</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
           max-width: 32rem; margin: 8rem auto; padding: 0 1.5rem;
           line-height: 1.5; color: #1a1612; }
    h1 { font-weight: 400; font-size: 2rem; letter-spacing: -0.02em; margin: 0 0 .5rem; }
    p { color: #514738; margin: 0 0 1rem; }
    a { color: #1a1612; }
  </style>
</head>
<body>
  <h1>Welcome to your Rainbow.</h1>
  <p>This is your domain. Set a home page in the <a href="/dashboard">dashboard's app builder</a>, or sign in to get started.</p>
  <p><a href="/dashboard">→ Sign in to your dashboard</a></p>
</body>
</html>`);
    });

    app.listen(PORT, () => {
        console.log(`[rainbow-web] listening on :${PORT}`);
        console.log(`[rainbow-web]   dashboard: ${DASHBOARD_DIR} → /dashboard`);
        console.log(`[rainbow-web]   apps:      ${APPS_DIR}`);
        console.log(`[rainbow-web]   home:      whichever app has is_home=true (or built-in placeholder)`);
    });
}
