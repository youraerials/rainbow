/**
 * /api/setup/* — endpoints used by the first-run setup wizard.
 *
 * Public to localhost (the rainbow-setup container is bound to 127.0.0.1
 * only by the .pkg installer's postinstall script). No auth — physical
 * access is the security model for first-run setup. Once provisioning
 * succeeds, the container shuts itself down and the real stack with
 * full OIDC auth takes over.
 */

import { Router, Request, Response as ExpressResponse } from "express";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { readState, patchState, SetupState } from "./state.js";
import { provision } from "./provision.js";

export const setupRouter = Router();

const SUBDOMAIN_WORKER_URL =
    process.env.RAINBOW_SUBDOMAIN_WORKER_URL ??
    "https://rainbow-subdomain-manager.misteranderson.workers.dev";
const SUBDOMAIN_API_SECRET = process.env.RAINBOW_SUBDOMAIN_API_SECRET ?? "";
const CONTROL_URL = process.env.RAINBOW_CONTROL_URL ?? "http://host.docker.internal:9001";
const CONTROL_TOKEN = process.env.RAINBOW_CONTROL_TOKEN ?? "";
const CLOUDFLARED_DIR =
    process.env.RAINBOW_CLOUDFLARED_DIR ?? "/var/lib/rainbow/cloudflared";

// ─── State ─────────────────────────────────────────────────────

setupRouter.get("/state", async (_req, res) => {
    res.json(await readState());
});

setupRouter.patch("/state", async (req: Request, res: ExpressResponse) => {
    const patch = req.body as Partial<SetupState>;
    if (!patch || typeof patch !== "object") {
        res.status(400).json({ error: "body must be a JSON object" });
        return;
    }
    res.json(await patchState(patch));
});

// ─── Preflight check ──────────────────────────────────────────

interface PreflightResult {
    macosVersion: string;
    appleSilicon: boolean;
    controlDaemonUp: boolean;
    subdomainWorkerReachable: boolean;
    pass: boolean;
    failures: string[];
}

setupRouter.post("/preflight", async (_req, res) => {
    const failures: string[] = [];
    const macosVersion = os.release();
    const arch = os.arch();
    const appleSilicon = arch === "arm64";
    if (!appleSilicon) failures.push(`Apple Silicon required (got ${arch})`);

    let controlDaemonUp = false;
    try {
        const r = await fetchWithTimeout(`${CONTROL_URL}/healthz`, 4000);
        controlDaemonUp = r.ok;
    } catch {
        // fall through
    }
    if (!controlDaemonUp) failures.push("Host control daemon not reachable at " + CONTROL_URL);

    let subdomainWorkerReachable = false;
    try {
        const r = await fetchWithTimeout(`${SUBDOMAIN_WORKER_URL}/health`, 4000);
        subdomainWorkerReachable = r.ok;
    } catch {
        // fall through
    }
    if (!subdomainWorkerReachable) failures.push("Subdomain Worker unreachable: " + SUBDOMAIN_WORKER_URL);

    const result: PreflightResult = {
        macosVersion,
        appleSilicon,
        controlDaemonUp,
        subdomainWorkerReachable,
        pass: failures.length === 0,
        failures,
    };

    if (result.pass) {
        await patchState({
            preflight: {
                passedAt: new Date().toISOString(),
                macosVersion,
                appleSilicon,
                controlDaemonUp,
            },
        });
    }
    res.json(result);
});

// ─── Check subdomain availability (claim path) ──────────────

setupRouter.get("/check/:name", async (req, res) => {
    const name = encodeURIComponent(req.params.name ?? "");
    try {
        const r = await fetchWithTimeout(
            `${SUBDOMAIN_WORKER_URL}/check/${name}`,
            8000,
        );
        const body = await r.json();
        res.status(r.status).json(body);
    } catch (err) {
        res.status(502).json({
            error: "Subdomain Worker unreachable",
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ─── Provision (claim path) ──────────────────────────────────
// Calls the Worker's /provision endpoint, then takes the response and
// writes the tunnel credentials to ~/.cloudflared/<id>.json + asks the
// host control daemon to store the inboundMailSecret in Keychain.

interface ProvisionBody {
    name: string;
    ownerEmail: string;
}

setupRouter.post("/provision", async (req: Request, res: ExpressResponse) => {
    if (!SUBDOMAIN_API_SECRET) {
        res.status(503).json({
            error:
                "RAINBOW_SUBDOMAIN_API_SECRET not configured — set it on the rainbow-setup container so it can authenticate to the operator Worker.",
        });
        return;
    }

    const body = req.body as Partial<ProvisionBody>;
    if (!body.name || !body.ownerEmail) {
        res.status(400).json({ error: "name and ownerEmail are required" });
        return;
    }

    let workerResp: globalThis.Response;
    try {
        workerResp = await fetchWithTimeout(`${SUBDOMAIN_WORKER_URL}/provision`, 30000, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${SUBDOMAIN_API_SECRET}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: body.name,
                ownerEmail: body.ownerEmail,
            }),
        });
    } catch (err) {
        res.status(502).json({
            error: "Subdomain Worker call failed",
            detail: err instanceof Error ? err.message : String(err),
        });
        return;
    }

    const data = (await workerResp.json()) as ProvisionWorkerResponse;
    if (!workerResp.ok || !data.success) {
        res.status(workerResp.status).json(data);
        return;
    }

    // 1. Write the tunnel credentials JSON. The host bind-mounts ~/.cloudflared
    //    into the container at CLOUDFLARED_DIR — orchestrator's start_cloudflared
    //    reads from $HOME/.cloudflared on the host so the path is shared.
    const credsPath = path.join(CLOUDFLARED_DIR, `${data.tunnel.id}.json`);
    try {
        await fs.mkdir(CLOUDFLARED_DIR, { recursive: true });
        await fs.writeFile(
            credsPath,
            JSON.stringify(data.tunnel.credentials, null, 2),
            "utf8",
        );
    } catch (err) {
        res.status(500).json({
            error: "failed to write tunnel credentials",
            detail: err instanceof Error ? err.message : String(err),
        });
        return;
    }

    // 2. Hand the per-tenant inbound HMAC secret to the host control
    //    daemon for storage in Keychain — same pattern as our other
    //    rainbow-* secrets. mcp-email and the inbound-mail handler both
    //    expect to find it there post-provision.
    let keychainOk = false;
    try {
        const r = await fetchWithTimeout(
            `${CONTROL_URL}/keychain/rainbow-inbound-mail-secret`,
            8000,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${CONTROL_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ value: data.inboundMailSecret }),
            },
        );
        keychainOk = r.ok;
    } catch (err) {
        console.error("[setup/provision] Keychain write failed:", err);
    }

    // 3. Persist to setup state so subsequent steps can read.
    await patchState({
        domain: {
            mode: "claim",
            prefix: body.name,
            zone: zoneFromApex(data.domain),
            apex: data.domain,
        },
        tunnel: {
            id: data.tunnel.id,
            name: data.tunnel.name,
            credentialsWrittenTo: credsPath,
        },
        admin: { email: body.ownerEmail, name: "" },
    });

    res.json({
        ok: true,
        domain: data.domain,
        serviceHostnames: data.serviceHostnames,
        tunnelId: data.tunnel.id,
        credentialsPath: credsPath,
        keychainStored: keychainOk,
    });
});

// ─── Streaming provision (full SSE flow) ────────────────────
// `dryRun=1` query param stops after rainbow.yaml is rendered without
// touching the orchestrator — useful while the user still has another
// Rainbow stack running.
setupRouter.post("/provision/stream", async (req: Request, res: ExpressResponse) => {
    const body = req.body as Partial<ProvisionBody> & { dryRun?: boolean };
    if (!body.name || !body.ownerEmail) {
        res.status(400).json({ error: "name and ownerEmail are required" });
        return;
    }
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });
    res.write(`event: started\ndata: {"name":"${body.name}"}\n\n`);

    const closed = { value: false };
    res.on("close", () => {
        closed.value = true;
    });

    try {
        for await (const ev of provision({
            name: body.name,
            ownerEmail: body.ownerEmail,
            dryRun: body.dryRun === true || (req.query.dryRun ?? "") === "1",
        })) {
            if (closed.value) break;
            res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        }
    } catch (err) {
        if (!closed.value) {
            const message = err instanceof Error ? err.message : String(err);
            res.write(`event: fatal\ndata: ${JSON.stringify({ type: "fatal", message })}\n\n`);
        }
    } finally {
        if (!closed.value) res.end();
    }
});

// ─── Helpers ────────────────────────────────────────────────────

interface ProvisionWorkerResponse {
    success: boolean;
    domain: string;
    serviceHostnames: string[];
    tunnel: {
        id: string;
        name: string;
        credentials: {
            AccountTag: string;
            TunnelID: string;
            TunnelName: string;
            TunnelSecret: string;
        };
    };
    inboundMailSecret: string;
    error?: string;
}

function zoneFromApex(apex: string): string {
    // "aubrey.rainbow.rocks" → "rainbow.rocks"
    const parts = apex.split(".");
    if (parts.length <= 2) return apex;
    return parts.slice(1).join(".");
}

async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init: RequestInit = {},
): Promise<globalThis.Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}
