/**
 * /api/apps — list, get, delete apps; per-app key/value data CRUD.
 * Generation lives in apps-generate.ts so this file stays focused.
 */

import { Router, Request, Response } from "express";
import {
    listApps,
    getApp,
    deleteApp,
    setHomeApp,
    unsetHomeApp,
    getAllAppData,
    getAppData,
    setAppData,
    deleteAppData,
} from "../db/apps.js";
import { isConfigured as dbConfigured } from "../db/pool.js";
import { removeAppFiles } from "../apps/files.js";
import { generateApp } from "../apps/generate.js";

export const appsRouter = Router();

const WEB_HOST = process.env.RAINBOW_WEB_HOST ?? "";

function requireDb(_req: Request, res: Response, next: () => void): void {
    if (!dbConfigured()) {
        res.status(503).json({ error: "database not configured" });
        return;
    }
    next();
}

appsRouter.get("/", requireDb, async (_req, res) => {
    const apps = await listApps();
    res.json({ count: apps.length, apps });
});

// POST /api/apps/generate — drives Claude through one app generation.
// Synchronous; takes ~10-60s depending on the prompt.
appsRouter.post("/generate", requireDb, async (req: Request, res: Response) => {
    const body = req.body as Partial<{
        slug: string;
        name: string;
        prompt: string;
        description: string;
    }>;
    if (!body.slug || !body.name || !body.prompt) {
        res.status(400).json({
            error: "missing required field(s): slug, name, prompt",
        });
        return;
    }
    try {
        const result = await generateApp({
            slug: body.slug,
            name: body.name,
            prompt: body.prompt,
            description: body.description,
            generatedBy: req.user?.email ?? req.user?.sub ?? undefined,
            webHost: WEB_HOST,
        });
        res.status(201).json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = /already exists|invalid|missing|no Anthropic/.test(message)
            ? 400
            : 500;
        res.status(status).json({ error: message });
    }
});

function param(req: Request, name: string): string {
    const v = req.params[name];
    if (typeof v !== "string") return "";
    return v;
}

appsRouter.get("/:slug", requireDb, async (req, res) => {
    const app = await getApp(param(req, "slug"));
    if (!app) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    res.json(app);
});

appsRouter.delete("/:slug", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const removed = await deleteApp(slug);
    if (!removed) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    await removeAppFiles(slug);
    res.json({ ok: true });
});

// ─── home app — at most one app is served at the root of the host ─

appsRouter.post("/:slug/home", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const ok = await setHomeApp(slug);
    if (!ok) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    res.json({ ok: true, slug, isHome: true });
});

appsRouter.delete("/:slug/home", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    await unsetHomeApp(slug);
    res.json({ ok: true, slug, isHome: false });
});

// ─── per-app key/value data ──────────────────────────────────────

appsRouter.get("/:slug/data", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const app = await getApp(slug);
    if (!app) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    const data = await getAllAppData(slug);
    res.json(data);
});

appsRouter.get("/:slug/data/:key", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const key = param(req, "key");
    const app = await getApp(slug);
    if (!app) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    const value = await getAppData(slug, key);
    if (value === null) {
        res.status(404).json({ error: "key not found" });
        return;
    }
    res.json(value);
});

appsRouter.put("/:slug/data/:key", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const key = param(req, "key");
    const app = await getApp(slug);
    if (!app) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    if (req.body === undefined) {
        res.status(400).json({ error: "missing JSON body" });
        return;
    }
    await setAppData(slug, key, req.body);
    res.json({ ok: true });
});

appsRouter.delete("/:slug/data/:key", requireDb, async (req, res) => {
    const slug = param(req, "slug");
    const key = param(req, "key");
    const app = await getApp(slug);
    if (!app) {
        res.status(404).json({ error: "app not found" });
        return;
    }
    const removed = await deleteAppData(slug, key);
    res.json({ ok: removed });
});
