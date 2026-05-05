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
    // Regex route (vs `/*splat`) because path-to-regexp v8 wildcards
    // require at least one segment, so `/*splat` skips a request to
    // bare `/` — exactly the case this fallback exists to handle.
    app.get(/.*/, (_req, res) => {
        res.status(200).type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rainbow</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f4ecd8;
      --surface: #ece1c7;
      --border: #b3a888;
      --text: #1a1612;
      --text-dim: #514738;
    }
    html, body {
      font-family: "Bricolage Grotesque", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      color: var(--text);
      background: var(--bg);
      font-size: clamp(15px, 0.9vw + 11px, 17px);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    body {
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 0%, rgba(26, 22, 18, 0.025), transparent 50%),
        radial-gradient(circle at 80% 100%, rgba(26, 22, 18, 0.03), transparent 55%),
        var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      position: relative;
      overflow-x: hidden;
    }
    main {
      max-width: 36rem;
      width: 100%;
      text-align: left;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      margin-bottom: 3rem;
      color: var(--text);
    }
    .logo svg { display: block; }
    .wordmark {
      font-family: "Fraunces", "Iowan Old Style", Georgia, serif;
      font-style: italic;
      font-size: 1.7rem;
      font-weight: 500;
      letter-spacing: -0.03em;
      font-variation-settings: "opsz" 60, "SOFT" 80, "WONK" 0;
    }
    .eyebrow {
      font-size: 0.78rem;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 1rem;
    }
    h1 {
      font-family: "Fraunces", "Iowan Old Style", Georgia, serif;
      font-weight: 300;
      font-size: clamp(2.4rem, 5vw, 3.6rem);
      letter-spacing: -0.025em;
      line-height: 1.05;
      color: var(--text);
      margin-bottom: 1.5rem;
    }
    h1 em {
      font-style: italic;
      font-variation-settings: "opsz" 144, "SOFT" 100, "WONK" 1;
    }
    .lede {
      font-size: 1.05rem;
      color: var(--text-dim);
      max-width: 30rem;
      margin-bottom: 2.25rem;
    }
    .actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .btn-primary {
      display: inline-block;
      background: var(--text);
      color: var(--bg);
      padding: 0.75rem 1.4rem;
      border: 1px solid var(--text);
      font-family: inherit;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 220ms cubic-bezier(0.2, 0.65, 0.35, 1);
    }
    .btn-primary:hover {
      transform: translate(-2px, -2px);
      box-shadow: 6px 6px 0 var(--border);
      background: var(--text-dim);
    }
    .btn-primary:active {
      transform: translate(0, 0);
      box-shadow: 0 0 0 transparent;
    }
    .btn-secondary {
      color: var(--text-dim);
      text-decoration: underline;
      text-decoration-color: var(--border);
      text-underline-offset: 3px;
      font-size: 0.92rem;
      padding: 0.75rem 0.5rem;
    }
    .btn-secondary:hover { color: var(--text); text-decoration-color: var(--text); }
    .footnote {
      margin-top: 3rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--text-dim);
      max-width: 30rem;
    }
    .footnote a {
      color: var(--text);
      text-decoration: underline;
      text-decoration-color: var(--border);
      text-underline-offset: 2px;
    }
    .footnote a:hover { text-decoration-color: var(--text); }
  </style>
</head>
<body>
  <main>
    <div class="logo">
      <svg viewBox="0 0 100 60" width="36" height="22" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M 10 50 A 40 40 0 0 1 90 50" stroke-width="4" />
        <path d="M 18 50 A 32 32 0 0 1 82 50" stroke-width="4" />
        <path d="M 26 50 A 24 24 0 0 1 74 50" stroke-width="4" />
        <path d="M 34 50 A 16 16 0 0 1 66 50" stroke-width="4" />
        <path d="M 42 50 A 8 8 0 0 1 58 50" stroke-width="4" />
      </svg>
      <span class="wordmark">rainbow</span>
    </div>

    <div class="eyebrow">Your domain</div>
    <h1>This is the front door to <em>your</em> Rainbow.</h1>
    <p class="lede">
      Anyone visiting this address sees this page. Build your own home in the
      app builder &mdash; a profile, a portfolio, a guestbook, anything &mdash;
      and set it as default to take over this view.
    </p>
    <div class="actions">
      <a href="/dashboard" class="btn-primary">Sign in to your dashboard</a>
      <a href="/dashboard/builder" class="btn-secondary">Open the app builder &rarr;</a>
    </div>

    <div class="footnote">
      Rainbow is a self-hosted digital life platform. Email, photos, files,
      docs, and AI &mdash; all running on your hardware, none of it on
      anyone else's cloud.
    </div>
  </main>
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
