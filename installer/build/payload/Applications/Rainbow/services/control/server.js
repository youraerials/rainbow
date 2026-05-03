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

// Keychain entries the daemon is allowed to write. Restricting to
// rainbow-* prefix keeps a compromised setup container from rewriting
// arbitrary system secrets. Read-back is intentionally not supported —
// the daemon is write-only for Keychain (no API to fetch values back).
const KEYCHAIN_NAME = /^rainbow-[a-z0-9-]+$/;

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

// Whitelisted scripts the setup wizard / dashboard may invoke. Path is
// resolved against RAINBOW_ROOT so the daemon never executes anything
// outside the project tree, regardless of caller intent.
const ALLOWED_RUN_TASKS = {
    "generate-config": "scripts/generate-config.sh",
    "start-minimum":   "services/orchestrator.sh:minimum",
    "setup-providers": "services/authentik/setup-providers.sh",
};

// POST /run/<task> — runs a whitelisted script and streams its stdout +
// stderr as Server-Sent Events. Used by the setup wizard to surface
// long-running orchestration progress to the browser. Each line of
// output becomes a single SSE message; on exit we emit a final
// `event: done` with the exit code.
function handleRun(task, res) {
    const target = ALLOWED_RUN_TASKS[task];
    if (!target) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `unknown task: ${task}` }));
        return;
    }
    const [scriptRel, arg] = target.split(":");
    const scriptPath = path.join(RAINBOW_ROOT, scriptRel);
    const args = arg ? [scriptPath, arg] : [scriptPath];

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });
    res.write(`event: started\ndata: {"task":"${task}"}\n\n`);

    const child = spawn("/bin/bash", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, RAINBOW_ROOT },
    });
    const sendLine = (stream, line) => {
        if (!line) return;
        const payload = JSON.stringify({ stream, line });
        res.write(`event: log\ndata: ${payload}\n\n`);
    };
    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout.on("data", (d) => {
        stdoutBuf += d.toString();
        let idx;
        while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
            sendLine("stdout", stdoutBuf.slice(0, idx));
            stdoutBuf = stdoutBuf.slice(idx + 1);
        }
    });
    child.stderr.on("data", (d) => {
        stderrBuf += d.toString();
        let idx;
        while ((idx = stderrBuf.indexOf("\n")) >= 0) {
            sendLine("stderr", stderrBuf.slice(0, idx));
            stderrBuf = stderrBuf.slice(idx + 1);
        }
    });
    child.on("close", (code) => {
        // flush partial lines
        sendLine("stdout", stdoutBuf);
        sendLine("stderr", stderrBuf);
        res.write(`event: done\ndata: ${JSON.stringify({ task, code })}\n\n`);
        res.end();
    });
    child.on("error", (err) => {
        res.write(`event: error\ndata: ${JSON.stringify({ task, error: String(err) })}\n\n`);
        res.end();
    });
}

// PUT /keychain/<service> — store a secret in the user's macOS Keychain
// under the given service name. Body: { value: "..." }. Used by the
// rainbow-setup container to persist provision-time secrets without
// needing direct Keychain access from inside Apple Container's VM.
async function handleKeychainPut(service, body) {
    if (!KEYCHAIN_NAME.test(service)) {
        return {
            status: 400,
            body: { error: `service must match ${KEYCHAIN_NAME}` },
        };
    }
    let payload;
    try {
        payload = JSON.parse(body);
    } catch {
        return { status: 400, body: { error: "body must be JSON" } };
    }
    const value = payload && typeof payload.value === "string" ? payload.value : "";
    if (!value) {
        return { status: 400, body: { error: "missing 'value' field" } };
    }
    return new Promise((resolve) => {
        const child = spawn(
            "/usr/bin/security",
            [
                "add-generic-password",
                "-s", service,
                "-a", "rainbow",
                "-w", value,
                "-U",
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) =>
            resolve({ status: 500, body: { error: String(err) } }),
        );
        child.on("close", (code) =>
            resolve(
                code === 0
                    ? { status: 200, body: { ok: true, service } }
                    : { status: 500, body: { error: stderr.trim() || `security exit ${code}` } },
            ),
        );
    });
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

    // POST /run/<task> — stream output of a whitelisted host script via SSE
    const runMatch = req.url && req.url.match(/^\/run\/([a-z-]+)$/);
    if (req.method === "POST" && runMatch) {
        return handleRun(runMatch[1], res);
    }

    // PUT /keychain/<service> — write a Keychain secret
    const keychainMatch = req.url && req.url.match(/^\/keychain\/([^/?]+)$/);
    if (req.method === "PUT" && keychainMatch) {
        const [, service] = keychainMatch;
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const result = await handleKeychainPut(decodeURIComponent(service), body);
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result.body));
        });
        return;
    }

    return fail(res, 404, "no such route");
});

server.listen(PORT, HOST, () => {
    console.log(`[control] listening on ${HOST}:${PORT}`);
});
