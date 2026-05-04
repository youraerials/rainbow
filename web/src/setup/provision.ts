/**
 * Setup-time orchestration. Runs as an async generator so the route
 * handler can iterate and pipe phase events out as Server-Sent Events.
 *
 * Phases (each yielded as a discrete event):
 *   1. claim         → call Worker /provision, write tunnel creds
 *   2. mint-secrets  → mint per-service secrets in Keychain via daemon
 *   3. render-yaml   → write rainbow.yaml from wizard state
 *   4. generate      → run scripts/generate-config.sh (streams output)
 *   5. start-stack   → run services/orchestrator.sh minimum (streams output)
 *   6. wait-authentik → poll Authentik until ready (~60–90s)
 *   7. setup-providers → run services/authentik/setup-providers.sh
 *   8. bootstrap-admin → create the user's admin account via Authentik API
 *   9. complete      → mark state, return dashboard URL
 *
 * In dryRun mode we stop after phase 3 (render-yaml) and DON'T touch
 * the running rainbow-* containers — useful for testing the wizard
 * without swapping deployments.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { patchState, readState } from "./state.js";
import { renderRainbowYaml } from "./yaml.js";

const SUBDOMAIN_WORKER_URL =
    process.env.RAINBOW_SUBDOMAIN_WORKER_URL ??
    "https://rainbow-subdomain-manager.misteranderson.workers.dev";
const SUBDOMAIN_API_SECRET = process.env.RAINBOW_SUBDOMAIN_API_SECRET ?? "";
const CONTROL_URL =
    process.env.RAINBOW_CONTROL_URL ?? "http://host.docker.internal:9001";
const CONTROL_TOKEN = process.env.RAINBOW_CONTROL_TOKEN ?? "";
const RAINBOW_ROOT = process.env.RAINBOW_ROOT ?? "/Users/aubrey/Work/rainbow";
const CLOUDFLARED_DIR =
    process.env.RAINBOW_CLOUDFLARED_DIR ?? "/var/lib/rainbow/cloudflared";
const ZONE_ID = process.env.RAINBOW_OPERATOR_ZONE_ID ?? "df1a726c81d085bb50a8be9f30d82730";

export type PhaseEvent =
    | { type: "phase-start"; phase: string; description: string }
    | { type: "phase-log"; phase: string; line: string; stream?: "stdout" | "stderr" }
    | { type: "phase-done"; phase: string }
    | { type: "phase-error"; phase: string; message: string }
    | { type: "complete"; domain: string; dashboardUrl: string }
    | { type: "fatal"; message: string };

export interface ProvisionInput {
    name: string;
    ownerEmail: string;
    /** When true, stop after rainbow.yaml is rendered. No orchestrator run. */
    dryRun?: boolean;
}

const PHASES = {
    claim:           "Claiming your subdomain on rainbow.rocks",
    "mint-secrets":  "Minting per-service secrets",
    "render-yaml":   "Rendering configuration",
    generate:        "Generating service configurations",
    "start-stack":   "Starting your Rainbow services",
    "wait-authentik":"Waiting for the identity service to come online",
    "setup-providers":"Wiring up single sign-on",
    "restart-web":   "Activating the dashboard",
    "bootstrap-admin":"Creating your administrator account",
};

export async function* provision(
    input: ProvisionInput,
): AsyncGenerator<PhaseEvent, void, unknown> {
    if (!SUBDOMAIN_API_SECRET) {
        yield {
            type: "fatal",
            message:
                "RAINBOW_SUBDOMAIN_API_SECRET not set — the setup container can't authenticate to the operator Worker. Run with that env var pasted from your local Keychain.",
        };
        return;
    }

    // ─── Phase 1: claim ───────────────────────────────────────
    yield phaseStart("claim");
    let claim: ClaimResult;
    try {
        claim = await callWorkerProvision(input.name, input.ownerEmail);
    } catch (err) {
        yield phaseError("claim", err);
        return;
    }
    yield phaseLog("claim", `Tunnel ${claim.tunnel.id} created`);
    for (const h of claim.serviceHostnames) {
        yield phaseLog("claim", `  DNS: ${h}`);
    }

    // Write tunnel credentials to bind-mounted ~/.cloudflared
    const credsPath = path.join(CLOUDFLARED_DIR, `${claim.tunnel.id}.json`);
    try {
        await fs.mkdir(CLOUDFLARED_DIR, { recursive: true });
        await fs.writeFile(
            credsPath,
            JSON.stringify(claim.tunnel.credentials, null, 2),
            "utf8",
        );
        yield phaseLog("claim", `Credentials written to ${credsPath}`);
    } catch (err) {
        yield phaseError("claim", err);
        return;
    }

    // Inbound HMAC secret → Keychain
    try {
        await daemonKeychainPut("rainbow-inbound-mail-secret", claim.inboundMailSecret);
    } catch (err) {
        yield phaseError("claim", err);
        return;
    }

    {
        const cur = await readState();
        await patchState({
            domain: {
                mode: "claim",
                prefix: input.name,
                zone: zoneFromApex(claim.domain),
                apex: claim.domain,
            },
            tunnel: {
                id: claim.tunnel.id,
                name: claim.tunnel.name,
                credentialsWrittenTo: credsPath,
            },
            // Preserve password so mint-secrets can stash it in Keychain
            // (patchState is a shallow merge — without this, the password
            // the user typed in AdminStep gets wiped here).
            admin: {
                email: input.ownerEmail,
                name: cur.admin?.name ?? "",
                password: cur.admin?.password,
            },
        });
    }
    yield phaseDone("claim");

    // ─── Phase 2: mint-secrets ────────────────────────────────
    yield phaseStart("mint-secrets");
    const adminPassword = (await readState()).admin?.password ?? "";
    if (!adminPassword) {
        yield phaseError(
            "mint-secrets",
            new Error("Admin password missing from state — go back to the Admin step and set one."),
        );
        return;
    }
    const minted: Array<readonly [string, string]> = [
        ["rainbow-postgres-password", randomHex(24)],
        ["rainbow-mariadb-root-password", randomHex(24)],
        ["rainbow-authentik-secret", randomHex(50)],
        ["rainbow-authentik-bootstrap-password", randomHex(20)],
        ["rainbow-seafile-admin-password", randomHex(20)],
        // Per-service admin / API secrets used by post-start hooks.
        // immich/setup.sh, jellyfin/setup.sh, cryptpad's templated
        // config, and authentik's own setup-providers.sh all expect
        // these in Keychain. The Authentik token doubles as
        // AUTHENTIK_BOOTSTRAP_TOKEN — Authentik provisions an API
        // token with this exact value on first boot, so
        // setup-providers.sh can authenticate without the user
        // having to mint one in the Authentik UI.
        ["rainbow-immich-admin-password", randomHex(24)],
        ["rainbow-jellyfin-admin-password", randomHex(24)],
        ["rainbow-cryptpad-admin-key", randomHex(24)],
        ["rainbow-authentik-api-token", randomHex(32)],
        // The user-chosen admin password. bootstrap-admin.sh reads
        // this and creates the actual Authentik user with it.
        ["rainbow-admin-password", adminPassword],
    ];
    try {
        for (const [name, value] of minted) {
            await daemonKeychainPut(name, value);
            yield phaseLog(
                "mint-secrets",
                `  ${name}${name === "rainbow-admin-password" ? " (from your input)" : ""}`,
            );
        }
    } catch (err) {
        yield phaseError("mint-secrets", err);
        return;
    }
    // Password is safely in Keychain now — clear it from setup-state.json
    // so it doesn't sit in plaintext on disk after the wizard finishes.
    {
        const cur = await readState();
        if (cur.admin) {
            await patchState({
                admin: { email: cur.admin.email, name: cur.admin.name },
            });
        }
    }
    yield phaseDone("mint-secrets");

    // ─── Phase 3: render-yaml ─────────────────────────────────
    yield phaseStart("render-yaml");
    const yaml = renderRainbowYaml({
        state: await readState(),
        zoneId: ZONE_ID,
        tunnelId: claim.tunnel.id,
    });
    const yamlPath = path.join(RAINBOW_ROOT, "config", "rainbow.yaml");
    try {
        await fs.writeFile(yamlPath, yaml, "utf8");
        yield phaseLog("render-yaml", `Wrote ${yamlPath} (${yaml.length} bytes)`);
    } catch (err) {
        yield phaseError("render-yaml", err);
        return;
    }
    yield phaseDone("render-yaml");

    if (input.dryRun) {
        yield {
            type: "fatal",
            message:
                "Dry run requested — stopping before orchestrator. Subdomain is claimed, secrets are in Keychain, rainbow.yaml is rendered. Re-run without dryRun (or hand-execute orchestrator) to bring the stack up.",
        };
        return;
    }

    // ─── Phase 4: generate ─────────────────────────────────────
    yield* relayDaemonRun("generate", "generate-config");

    // ─── Phase 5: start-stack ──────────────────────────────────
    yield* relayDaemonRun("start-stack", "start-minimum");

    // ─── Phase 6: wait-authentik ──────────────────────────────
    yield phaseStart("wait-authentik");
    const authUrl = `https://${input.name}-auth.${zoneFromApex(claim.domain)}/-/health/ready/`;
    let ready = false;
    for (let i = 0; i < 90; i++) {
        try {
            const r = await fetchWithTimeout(authUrl, 4000);
            if (r.ok) {
                ready = true;
                break;
            }
        } catch {
            // keep polling
        }
        yield phaseLog("wait-authentik", `attempt ${i + 1}/90 — not ready yet`);
        await sleep(2000);
    }
    if (!ready) {
        yield phaseError("wait-authentik", new Error(`Authentik never became reachable at ${authUrl}`));
        return;
    }
    yield phaseDone("wait-authentik");

    // ─── Phase 7: setup-providers ──────────────────────────────
    yield* relayDaemonRun("setup-providers", "setup-providers");

    // ─── Phase 8: restart-web ──────────────────────────────────
    // start-stack tried to bring up rainbow-web before Authentik
    // existed — it crashed with "OIDC env not fully populated"
    // because the OAuth client_id/secret weren't in Keychain yet.
    // setup-providers just put them there, so recreate the
    // container now and it'll boot with a populated env.
    yield phaseStart("restart-web");
    try {
        await daemonRestart("rainbow-web");
        yield phaseLog("restart-web", "rainbow-web restarted with OIDC credentials");
    } catch (err) {
        yield phaseError("restart-web", err);
        return;
    }
    yield phaseDone("restart-web");

    // ─── Phase 9: bootstrap-admin ──────────────────────────────
    // Create the user's actual admin account in Authentik using the
    // bootstrap API token (minted in Phase 2, baked into Authentik's
    // first boot). The script reads the user's chosen password from
    // Keychain (rainbow-admin-password), creates a user with their
    // email + name, sets the password, adds to the Admins group.
    yield* relayDaemonRun("bootstrap-admin", "bootstrap-admin");

    // ─── Done ──────────────────────────────────────────────────
    await patchState({ completedAt: new Date().toISOString() });
    yield {
        type: "complete",
        domain: claim.domain,
        dashboardUrl: `https://${claim.domain}/`,
    };
}

// ─── Helpers ────────────────────────────────────────────────────

function phaseStart(phase: keyof typeof PHASES): PhaseEvent {
    return { type: "phase-start", phase, description: PHASES[phase] };
}
function phaseLog(phase: string, line: string, stream?: "stdout" | "stderr"): PhaseEvent {
    return { type: "phase-log", phase, line, stream };
}
function phaseDone(phase: string): PhaseEvent {
    return { type: "phase-done", phase };
}
function phaseError(phase: string, err: unknown): PhaseEvent {
    return {
        type: "phase-error",
        phase,
        message: err instanceof Error ? err.message : String(err),
    };
}

interface ClaimResult {
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
}

async function callWorkerProvision(
    name: string,
    ownerEmail: string,
): Promise<ClaimResult> {
    const r = await fetchWithTimeout(`${SUBDOMAIN_WORKER_URL}/provision`, 30000, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${SUBDOMAIN_API_SECRET}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, ownerEmail }),
    });
    const data = (await r.json()) as ClaimResult & { error?: string };
    if (!r.ok || !data.success) {
        throw new Error(`Worker /provision failed: ${data.error ?? r.status}`);
    }
    return data;
}

async function daemonKeychainPut(service: string, value: string): Promise<void> {
    const r = await fetchWithTimeout(
        `${CONTROL_URL}/keychain/${encodeURIComponent(service)}`,
        8000,
        {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${CONTROL_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ value }),
        },
    );
    if (!r.ok) {
        const text = await r.text();
        throw new Error(`daemon keychain PUT ${service} failed: ${r.status} ${text}`);
    }
}

async function daemonRestart(name: string): Promise<void> {
    // The daemon's /restart/<name> route delegates to orchestrator.sh's
    // restart-container, which destroys the existing container and
    // re-runs `start_<name>` from the orchestrator — re-reading env
    // from Keychain. Up to 60s for image pull + boot.
    const r = await fetchWithTimeout(
        `${CONTROL_URL}/restart/${encodeURIComponent(name)}`,
        60000,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
        },
    );
    if (!r.ok) {
        const text = await r.text();
        throw new Error(`daemon restart ${name} failed: ${r.status} ${text}`);
    }
}

/**
 * Stream events out of a daemon /run/<task> SSE endpoint and re-emit
 * them as PhaseEvents. The daemon emits `event: log` with stdout/stderr
 * lines and `event: done` with the exit code.
 */
async function* relayDaemonRun(
    phase: keyof typeof PHASES,
    task: "generate-config" | "start-minimum" | "setup-providers" | "bootstrap-admin",
): AsyncGenerator<PhaseEvent, void, unknown> {
    yield phaseStart(phase);
    let r: globalThis.Response;
    try {
        r = await fetch(`${CONTROL_URL}/run/${task}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
        });
    } catch (err) {
        yield phaseError(phase, err);
        return;
    }
    if (!r.ok || !r.body) {
        yield phaseError(phase, new Error(`daemon /run/${task} HTTP ${r.status}`));
        return;
    }

    let exitCode = -1;
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = r.body.getReader();
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE messages are separated by blank lines
            let idx;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const ev = parseSseBlock(block);
                if (!ev) continue;
                if (ev.event === "log") {
                    try {
                        const data = JSON.parse(ev.data) as { stream?: string; line?: string };
                        if (data.line) {
                            yield phaseLog(
                                phase,
                                data.line,
                                data.stream === "stderr" ? "stderr" : "stdout",
                            );
                        }
                    } catch {
                        // ignore non-JSON
                    }
                } else if (ev.event === "done") {
                    try {
                        const data = JSON.parse(ev.data) as { code?: number };
                        exitCode = data.code ?? -1;
                    } catch {
                        // ignore
                    }
                } else if (ev.event === "error") {
                    yield phaseError(phase, new Error(ev.data));
                    return;
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    if (exitCode !== 0) {
        yield phaseError(phase, new Error(`task exited with code ${exitCode}`));
        return;
    }
    yield phaseDone(phase);
}

function parseSseBlock(block: string): { event: string; data: string } | null {
    const lines = block.split("\n");
    let event = "";
    const dataLines: string[] = [];
    for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!event) return null;
    return { event, data: dataLines.join("\n") };
}

function randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString("hex");
}

function zoneFromApex(apex: string): string {
    const parts = apex.split(".");
    return parts.length <= 2 ? apex : parts.slice(1).join(".");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
