/**
 * Rainbow web tier.
 *
 * Single Express app serving:
 *   - /                → dashboard SPA (static, mounted at runtime from dashboard/dist)
 *   - /api/...         → admin REST endpoints (status, services, config)
 *   - /mcp             → MCP HTTP transport (aggregated tools across all services)
 *   - /apps/<name>/*   → user-generated apps loaded from a persistent volume (future)
 *
 * Runs in the rainbow-web container; reachable via Caddy at <prefix>-app.<zone>.
 */

import express from "express";
import path from "node:path";

import { apiRouter } from "./api/index.js";
import { attachMcp } from "./mcp/server.js";

const PORT = Number(process.env.PORT ?? 3000);
const DASHBOARD_DIR = process.env.RAINBOW_DASHBOARD_DIR ?? "/usr/share/web/dashboard";
const APPS_DIR = process.env.RAINBOW_APPS_DIR ?? "/var/lib/rainbow/apps";

const app = express();
app.use(express.json({ limit: "1mb" }));

// REST + MCP first so they don't collide with the SPA fallback.
app.use("/api", apiRouter);
attachMcp(app, "/mcp");

// Static dashboard, with SPA fallback for client-side routes.
// Express 5 dropped support for bare-`*` paths in path-to-regexp; we use a
// general middleware after express.static so anything not handled by the
// static layer falls through to index.html.
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
