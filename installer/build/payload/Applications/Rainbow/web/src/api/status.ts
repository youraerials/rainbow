/**
 * /api/status, /api/services — REST endpoints backing the dashboard HomeView
 * and ServicesView. Both share the same underlying liveness probe.
 */

import { Router, Request, Response } from "express";
import { checkAll } from "../services/health.js";
import { SERVICES, webHost } from "../services/registry.js";

export const statusRouter = Router();

// Dashboard's HomeView calls /api/status on load. Returns the user-facing
// domain plus a per-service `healthy` flag.
statusRouter.get("/status", async (_req: Request, res: Response) => {
    const services = await checkAll();
    res.json({
        domain: webHost(),
        services: services.map((s) => ({
            name: s.name,
            healthy: s.healthy,
            latencyMs: s.latencyMs,
        })),
        timestamp: new Date().toISOString(),
    });
});

// Richer view of the same data plus the static catalog metadata. Useful for
// the ServicesView (descriptions, display names) and for AI clients that
// want to enumerate services without separately knowing their slugs.
statusRouter.get("/services", async (_req: Request, res: Response) => {
    const health = await checkAll();
    const byName = new Map(health.map((h) => [h.name, h]));
    const services = SERVICES.map((s) => {
        const h = byName.get(s.name);
        return {
            name: s.name,
            slug: s.slug,
            displayName: s.displayName,
            description: s.description,
            url: `https://${s.slug ? `${process.env.RAINBOW_HOST_PREFIX ?? ""}${s.slug}.${process.env.RAINBOW_ZONE ?? ""}` : webHost()}`,
            healthy: h?.healthy ?? false,
            status: h?.status,
            latencyMs: h?.latencyMs,
            error: h?.error,
        };
    });
    res.json({ services });
});
