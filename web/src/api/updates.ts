/**
 * /api/updates/* — surface available updates to the dashboard.
 *
 * Two kinds of updates the user can take:
 *   1. Rainbow itself (app code + rainbow-web image). One click,
 *      no password, runs the daemon's `upgrade` task end to end.
 *   2. Apple Container (the `container` CLI + apiserver). Requires
 *      sudo to install — this endpoint just reports the version delta;
 *      the dashboard renders a banner with the upgrade command.
 *
 * Routes:
 *   GET  /api/updates/check          — combined report (Rainbow + Container)
 *   POST /api/updates/apply          — SSE: run the upgrade.sh task
 *   POST /api/updates/reload-daemon  — kickstart the host control daemon
 */

import { Router, Request, Response } from "express";
import { isConfigured, systemInfo, streamRun, reloadDaemon } from "../services/control.js";

export const updatesRouter = Router();

const REPO = process.env.RAINBOW_REPO ?? "youraerials/rainbow";
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface SystemInfoBody {
    rainbow: { installedVersion: string };
    container: { installedVersion: string; pinnedVersion: string };
    daemonReloadPending: boolean;
}

/** Cache the GitHub release lookup briefly so a dashboard polling every
 *  few minutes doesn't burn through the unauthenticated rate limit (60/h). */
let cachedRelease: { fetchedAt: number; tag: string; htmlUrl: string; name: string } | null = null;
const RELEASE_CACHE_MS = 5 * 60 * 1000;

async function fetchLatestRelease(): Promise<{ tag: string; version: string; htmlUrl: string; name: string }> {
    const now = Date.now();
    if (cachedRelease && now - cachedRelease.fetchedAt < RELEASE_CACHE_MS) {
        return {
            tag: cachedRelease.tag,
            version: cachedRelease.tag.replace(/^v/, ""),
            htmlUrl: cachedRelease.htmlUrl,
            name: cachedRelease.name,
        };
    }
    const r = await fetch(RELEASE_API, { headers: { "User-Agent": "rainbow-web" } });
    if (!r.ok) {
        throw new Error(`GitHub releases API returned ${r.status}`);
    }
    const data = (await r.json()) as { tag_name: string; html_url: string; name: string };
    cachedRelease = {
        fetchedAt: now,
        tag: data.tag_name,
        htmlUrl: data.html_url,
        name: data.name,
    };
    return {
        tag: data.tag_name,
        version: data.tag_name.replace(/^v/, ""),
        htmlUrl: data.html_url,
        name: data.name,
    };
}

updatesRouter.get("/check", async (_req, res) => {
    if (!isConfigured()) {
        res.status(503).json({ error: "control daemon not configured" });
        return;
    }
    try {
        const [info, release] = await Promise.all([
            systemInfo(),
            fetchLatestRelease(),
        ]);
        if (info.status >= 400) {
            res.status(info.status).json(info.body);
            return;
        }
        const sys = info.body as SystemInfoBody;
        const rainbowAvailable =
            sys.rainbow.installedVersion !== "" &&
            sys.rainbow.installedVersion !== release.version;
        const containerAvailable =
            sys.container.pinnedVersion !== "" &&
            sys.container.installedVersion !== "" &&
            sys.container.installedVersion !== sys.container.pinnedVersion;

        res.json({
            rainbow: {
                installedVersion: sys.rainbow.installedVersion,
                latestVersion: release.version,
                hasUpdate: rainbowAvailable,
                releaseUrl: release.htmlUrl,
                releaseName: release.name,
            },
            container: {
                installedVersion: sys.container.installedVersion,
                pinnedVersion: sys.container.pinnedVersion,
                hasUpdate: containerAvailable,
            },
            daemonReloadPending: sys.daemonReloadPending,
        });
    } catch (err) {
        res.status(502).json({ error: (err as Error).message });
    }
});

/**
 * Stream the upgrade task's output as Server-Sent Events. The daemon
 * emits `event: log`, `event: error`, `event: done` already — we just
 * pipe its bytes straight through.
 */
updatesRouter.post("/apply", async (_req: Request, res: Response) => {
    const upstream = await streamRun("upgrade");
    if (!upstream.ok || !upstream.body) {
        const body = await upstream.text().catch(() => "");
        res.status(upstream.status).type("application/json").send(body || "{}");
        return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const reader = upstream.body.getReader();
    const closed = new Promise<void>((resolve) => res.on("close", resolve));
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(Buffer.from(value));
            if ((res as Response & { closed?: boolean }).closed) break;
        }
    } catch {
        // Upstream broke. Best effort: end the response.
    } finally {
        res.end();
        await closed.catch(() => undefined);
    }
});

updatesRouter.post("/reload-daemon", async (_req, res) => {
    const r = await reloadDaemon();
    res.status(r.status).json(r.body);
});
