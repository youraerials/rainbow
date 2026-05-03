/**
 * /api/services/:slug/{restart,start,stop,logs} — proxies to the host control
 * daemon. The web container can't drive the `container` CLI itself, so the
 * dashboard's "restart" / "view logs" buttons land here, get translated from
 * slug → container name, and forwarded over HTTP to the daemon at
 * host.docker.internal:9001.
 */

import { Router, Request, Response } from "express";
import {
    findBySlug,
    containersFor,
    primaryContainerFor,
} from "../services/registry.js";
import {
    isConfigured,
    restart,
    start,
    stop,
    logs,
} from "../services/control.js";

export const servicesControlRouter = Router();

function param(req: Request, name: string): string {
    const v = req.params[name];
    return typeof v === "string" ? v : "";
}

function ensureControl(res: Response): boolean {
    if (!isConfigured()) {
        res.status(503).json({
            error:
                "control daemon not configured (RAINBOW_CONTROL_URL/RAINBOW_CONTROL_TOKEN missing). " +
                "Run services/control/install.sh on the host and restart the orchestrator.",
        });
        return false;
    }
    return true;
}

async function applyToAll(
    containers: string[],
    fn: (name: string) => Promise<{ ok: boolean; status: number; body: unknown; container: string }>,
) {
    const results = [];
    for (const c of containers) {
        results.push(await fn(c));
    }
    const ok = results.every((r) => r.ok);
    return { ok, results };
}

servicesControlRouter.post("/services/:slug/restart", async (req, res) => {
    if (!ensureControl(res)) return;
    const svc = findBySlug(param(req, "slug"));
    if (!svc) {
        res.status(404).json({ error: "unknown service slug" });
        return;
    }
    const { ok, results } = await applyToAll(containersFor(svc), restart);
    res.status(ok ? 200 : 502).json({ ok, slug: svc.slug, results });
});

servicesControlRouter.post("/services/:slug/start", async (req, res) => {
    if (!ensureControl(res)) return;
    const svc = findBySlug(param(req, "slug"));
    if (!svc) {
        res.status(404).json({ error: "unknown service slug" });
        return;
    }
    const { ok, results } = await applyToAll(containersFor(svc), start);
    res.status(ok ? 200 : 502).json({ ok, slug: svc.slug, results });
});

servicesControlRouter.post("/services/:slug/stop", async (req, res) => {
    if (!ensureControl(res)) return;
    const svc = findBySlug(param(req, "slug"));
    if (!svc) {
        res.status(404).json({ error: "unknown service slug" });
        return;
    }
    const { ok, results } = await applyToAll(containersFor(svc), stop);
    res.status(ok ? 200 : 502).json({ ok, slug: svc.slug, results });
});

// GET /api/services/:slug/logs?lines=200&container=rainbow-foo
// Defaults to the service's primary container; ?container= can target a
// specific one for multi-container services (e.g. rainbow-immich-ml).
servicesControlRouter.get("/services/:slug/logs", async (req, res) => {
    if (!ensureControl(res)) return;
    const svc = findBySlug(param(req, "slug"));
    if (!svc) {
        res.status(404).json({ error: "unknown service slug" });
        return;
    }
    const requested =
        typeof req.query.container === "string" ? req.query.container : "";
    const allowed = containersFor(svc);
    const target =
        requested && allowed.includes(requested)
            ? requested
            : primaryContainerFor(svc);
    const lines = Math.min(
        Math.max(Number(req.query.lines ?? 200) || 200, 1),
        5000,
    );
    const { status, body } = await logs(target, lines);
    res.status(status).json(body);
});
