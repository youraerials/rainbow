/**
 * /api/admin/* — admin-only configuration endpoints.
 *
 * Currently the only "admin" check is "is the user authenticated" (whoever
 * is logged into Authentik on this Rainbow instance). For a multi-user
 * deployment we'd want group-based RBAC; not yet.
 */

import { Router, Request, Response } from "express";
import { getConfigValue, setConfigValue } from "../db/config.js";
import { isConfigured as dbConfigured } from "../db/pool.js";

const ANTHROPIC_KEY_CONFIG = "anthropic.api_key";

export const adminRouter = Router();

adminRouter.get("/anthropic-key", async (_req: Request, res: Response) => {
    if (!dbConfigured()) {
        res.status(503).json({ error: "database not configured" });
        return;
    }
    const value = await getConfigValue<string>(ANTHROPIC_KEY_CONFIG);
    res.json({
        configured: typeof value === "string" && value.length > 0,
        // Return only a fingerprint, never the full key.
        suffix: typeof value === "string" ? value.slice(-4) : null,
    });
});

adminRouter.put("/anthropic-key", async (req: Request, res: Response) => {
    if (!dbConfigured()) {
        res.status(503).json({ error: "database not configured" });
        return;
    }
    const { key } = req.body as { key?: unknown };
    if (typeof key !== "string" || !key.startsWith("sk-")) {
        res.status(400).json({
            error: "missing or invalid `key` (Anthropic keys start with sk-)",
        });
        return;
    }
    await setConfigValue(ANTHROPIC_KEY_CONFIG, key);
    res.json({ ok: true, suffix: key.slice(-4) });
});

adminRouter.delete("/anthropic-key", async (_req: Request, res: Response) => {
    if (!dbConfigured()) {
        res.status(503).json({ error: "database not configured" });
        return;
    }
    await setConfigValue(ANTHROPIC_KEY_CONFIG, null);
    res.json({ ok: true });
});
