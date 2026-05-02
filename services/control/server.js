#!/usr/bin/env node
/*
 * Rainbow control daemon.
 *
 * Runs on the macOS host (NOT in a container) so it can call the `container`
 * CLI directly. Exposes a small HTTP API over IPv4+IPv6 on a localhost-bound
 * port; the rainbow-web container reaches it via `host.docker.internal`.
 *
 * Auth: shared bearer token from macOS Keychain (`rainbow-control-token`).
 * Anyone with that token can start/stop/restart Rainbow containers, so the
 * scope of damage is bounded — but still treat it like a privileged secret.
 *
 * Endpoints:
 *   POST /restart/:name         restart a container (container stop && start)
 *   POST /start/:name           start a stopped container
 *   POST /stop/:name            stop a running container
 *   GET  /logs/:name?lines=N    tail recent stderr/stdout (default 100 lines)
 *   GET  /healthz               unauth health check
 *
 * Container names are restricted to those matching ^rainbow-[a-z0-9-]+$ so a
 * compromised token can't be used to nuke unrelated containers.
 */

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");

const PORT = Number(process.env.RAINBOW_CONTROL_PORT || 9001);
const HOST = process.env.RAINBOW_CONTROL_HOST || "::";

// Path to the refresh-caddy script. Set by the launchd plist via
// RAINBOW_ROOT; falls back to a relative resolution for ad-hoc runs.
const RAINBOW_ROOT =
    process.env.RAINBOW_ROOT || path.resolve(__dirname, "..", "..");
const REFRESH_CADDY = path.join(RAINBOW_ROOT, "services", "refresh-caddy.sh");
const ORCHESTRATOR = path.join(RAINBOW_ROOT, "services", "orchestrator.sh");

const ALLOWED_NAME = /^rainbow-[a-z0-9-]+$/;
const VALID_ACTIONS = new Set(["start", "stop", "restart"]);

function loadTokenFromKeychain() {
    try {
        const out = execFileSync(
            "/usr/bin/security",
            ["find-generic-password", "-s", "rainbow-control-token", "-w"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return out.trim();
    } catch {
        return "";
    }
}

const TOKEN = loadTokenFromKeychain();
if (!TOKEN) {
    console.error(
        "[control] FATAL: rainbow-control-token not in Keychain. " +
            "Generate one with: security add-generic-password -s rainbow-control-token -a rainbow -w \"$(openssl rand -hex 32)\"",
    );
    process.exit(1);
}

function ok(res, body) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}
function fail(res, status, message) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
}

function authorized(req) {
    const header = req.headers["authorization"];
    if (typeof header !== "string") return false;
    if (!header.toLowerCase().startsWith("bearer ")) return false;
    return header.slice(7).trim() === TOKEN;
}

function runContainer(args, { capture = true } = {}) {
    return new Promise((resolve) => {
        const child = spawn("container", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        if (capture) {
            child.stdout.on("data", (d) => (stdout += d.toString()));
            child.stderr.on("data", (d) => (stderr += d.toString()));
        }
        child.on("error", (err) => resolve({ code: -1, stdout: "", stderr: String(err) }));
        child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

// Restarting a container assigns it a fresh IP — Caddy's compiled config
// still points at the old one, so we rebuild Caddyfile.compiled from the
// source template and tell Caddy to reload. Failures here are logged but
// don't fail the restart itself: the user can re-run refresh-caddy manually
// if needed, and the dashboard call already succeeded.
function refreshCaddy() {
    return new Promise((resolve) => {
        const child = spawn("/bin/bash", [REFRESH_CADDY], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", () => resolve({ ok: false }));
        child.on("close", (code) => {
            if (code !== 0 && stderr) {
                console.error(`[control] refresh-caddy failed: ${stderr.trim()}`);
            }
            resolve({ ok: code === 0 });
        });
    });
}

// Recreate a rainbow-* container with fresh env via orchestrator.sh. This
// re-reads Keychain entries every time, so secret rotation flows through
// without the user knowing about Apple Container's stop/start env-caching
// behavior. Caller still drives refreshCaddy() afterward to fix routing.
function recreateViaOrchestrator(name) {
    return new Promise((resolve) => {
        const child = spawn("/bin/bash", [ORCHESTRATOR, "restart-container", name], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) => resolve({ code: -1, stdout: "", stderr: String(err) }));
        child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

async function handleAction(action, name) {
    if (!VALID_ACTIONS.has(action)) {
        return { status: 400, body: { error: `unknown action: ${action}` } };
    }
    if (!ALLOWED_NAME.test(name)) {
        return {
            status: 400,
            body: { error: `name must match ${ALLOWED_NAME} — refusing` },
        };
    }
    if (action === "restart") {
        // Defer to orchestrator.sh: it re-reads Keychain + the .env file and
        // recreates the container with fresh env. A plain `container start`
        // would reuse the env baked in at original `run` time, so secret
        // rotation wouldn't take effect until next `make start`.
        const recreate = await recreateViaOrchestrator(name);
        let caddyRefresh = null;
        if (recreate.code === 0) {
            caddyRefresh = await refreshCaddy();
        }
        return {
            status: recreate.code === 0 ? 200 : 500,
            body: { action, name, recreate, caddyRefresh },
        };
    }
    const result = await runContainer([action, name]);
    // Stop+start also alter the container's IP — refresh Caddy when we start.
    let caddyRefresh = null;
    if (action === "start" && result.code === 0) {
        caddyRefresh = await refreshCaddy();
    }
    return {
        status: result.code === 0 ? 200 : 500,
        body: { action, name, result, caddyRefresh },
    };
}

async function handleLogs(name, lines) {
    if (!ALLOWED_NAME.test(name)) {
        return {
            status: 400,
            body: { error: `name must match ${ALLOWED_NAME} — refusing` },
        };
    }
    // Apple Container's `container logs` lacks a --tail flag, so we capture
    // and slice. Capping at a generous max prevents abuse.
    const result = await runContainer(["logs", name]);
    const max = Math.min(Math.max(Number(lines) || 100, 1), 5000);
    const allLines = (result.stdout + result.stderr).split("\n");
    const tailed = allLines.slice(Math.max(0, allLines.length - max - 1));
    return {
        status: result.code === 0 ? 200 : 500,
        body: {
            name,
            lines: tailed.length,
            content: tailed.join("\n"),
            error: result.code !== 0 ? result.stderr : undefined,
        },
    };
}

const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
        return ok(res, { status: "ok" });
    }

    if (!authorized(req)) {
        return fail(res, 401, "missing or invalid bearer token");
    }

    // POST /<action>/<name>
    const actionMatch = req.url && req.url.match(/^\/(start|stop|restart)\/([^/?]+)$/);
    if (req.method === "POST" && actionMatch) {
        const [, action, name] = actionMatch;
        const result = await handleAction(action, decodeURIComponent(name));
        res.writeHead(result.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result.body));
    }

    // GET /logs/<name>?lines=N
    const logsMatch = req.url && req.url.match(/^\/logs\/([^/?]+)(?:\?lines=(\d+))?$/);
    if (req.method === "GET" && logsMatch) {
        const [, name, lines] = logsMatch;
        const result = await handleLogs(decodeURIComponent(name), lines);
        res.writeHead(result.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result.body));
    }

    return fail(res, 404, "no such route");
});

server.listen(PORT, HOST, () => {
    console.log(`[control] listening on ${HOST}:${PORT}`);
});
