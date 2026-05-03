// Rainbow control daemon — pure Swift port of services/control/server.js.
//
// Runs as a launchd-managed process on the macOS host. The web tier (and
// setup wizard) reach it at host.docker.internal:9001 to:
//   • restart/start/stop Apple Container instances by name
//   • tail container logs
//   • run a fixed set of host scripts (orchestrator, generate-config,
//     setup-providers) and stream output as Server-Sent Events
//   • write secrets to the user's macOS Keychain
//
// We chose Swift over Node so a fresh macOS install needs no runtime
// beyond what Apple ships. The binary is precompiled in the release
// workflow and bundled in the .pkg payload at /Applications/Rainbow/bin/.
//
// Build locally:
//   swiftc -O Daemon.swift -o Rainbow-Control-Daemon
//
// Auth: shared bearer token from macOS Keychain (rainbow-control-token).
// Anyone with that token can manage Rainbow containers, so treat it like
// a privileged secret.

import Foundation
import Network

// ─── Config ─────────────────────────────────────────────────────

let port: UInt16 = UInt16(ProcessInfo.processInfo.environment["RAINBOW_CONTROL_PORT"] ?? "") ?? 9001
let rainbowRoot = ProcessInfo.processInfo.environment["RAINBOW_ROOT"]
    ?? "/Applications/Rainbow"
let refreshCaddy = "\(rainbowRoot)/services/refresh-caddy.sh"
let orchestrator = "\(rainbowRoot)/services/orchestrator.sh"

let allowedContainerName = #"^rainbow-[a-z0-9-]+$"#
let allowedKeychainName  = #"^rainbow-[a-z0-9-]+$"#
let validActions: Set<String> = ["start", "stop", "restart"]
let allowedRunTasks: [String: (script: String, arg: String?)] = [
    "generate-config":  ("scripts/generate-config.sh", nil),
    "start-minimum":    ("services/orchestrator.sh", "minimum"),
    "setup-providers":  ("services/authentik/setup-providers.sh", nil),
]

func log(_ message: String) {
    FileHandle.standardError.write(Data("[control] \(message)\n".utf8))
}

// Shown to the user right after the .pkg installer reports success.
// Polls /wizard-status until Phase B (the LaunchAgent that pulls the
// rainbow-web image from GHCR and starts the setup container) writes
// the wizard URL. Then redirects.
let setupProgressHTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Rainbow — getting ready</title>
<style>
  :root {
    color-scheme: light;
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4ecd8;
    color: #1a1612;
    font-family: "Iowan Old Style", "Hoefler Text", Georgia, serif;
    line-height: 1.55;
  }
  main {
    max-width: 32rem;
    padding: 3rem 2.5rem;
    text-align: left;
  }
  h1 {
    font-weight: 400;
    font-size: 2.6rem;
    letter-spacing: -0.025em;
    line-height: 1.05;
    margin: 0 0 1rem;
  }
  h1 em { font-style: italic; }
  .lede {
    font-size: 1.05rem;
    color: #514738;
    margin: 0 0 2rem;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 0.95rem;
    color: #1a1612;
    border-top: 1px solid #c5b89a;
    padding-top: 1.25rem;
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid #c5b89a;
    border-top-color: #1a1612;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
    flex: 0 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fineprint {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 0.85rem;
    color: #7a6e5c;
    margin-top: 1.5rem;
  }
  .fineprint code {
    background: #e3d6b8;
    border: 1px solid #b3a888;
    border-radius: 2px;
    padding: 0.05em 0.4em;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 0.92em;
  }
</style>
</head>
<body>
<main>
  <h1>Setting up <em>Rainbow</em>.</h1>
  <p class="lede">
    Rainbow is finishing in the background — fetching the container
    image and starting the setup wizard. This usually takes under a
    minute. This page will turn into the wizard automatically.
  </p>
  <div class="status">
    <div class="spinner" aria-hidden="true"></div>
    <div id="status-text">Fetching the Rainbow image…</div>
  </div>
  <p class="fineprint">
    Live install log: <code>tail -f /tmp/rainbow-install.log</code>
  </p>
</main>
<script>
  const statusEl = document.getElementById('status-text');
  let elapsed = 0;
  async function poll() {
    try {
      const r = await fetch('/wizard-status', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.ready && j.url) {
          statusEl.textContent = 'Ready — opening the wizard.';
          window.location.replace(j.url);
          return;
        }
      }
    } catch (e) { /* daemon may briefly hiccup; keep polling */ }
    elapsed += 2;
    if (elapsed >= 20 && elapsed < 60) {
      statusEl.textContent = 'Starting the setup wizard…';
    } else if (elapsed >= 60 && elapsed < 120) {
      statusEl.textContent = 'Waiting for the wizard to come online…';
    } else if (elapsed >= 120) {
      statusEl.textContent = 'Still working — see the install log if this stays stuck.';
    }
    setTimeout(poll, 2000);
  }
  poll();
</script>
</body>
</html>
"""

func loadTokenFromKeychain() -> String {
    let result = runSync("/usr/bin/security",
                        ["find-generic-password", "-s", "rainbow-control-token", "-w"])
    return result.exitCode == 0 ? result.stdout.trimmingCharacters(in: .whitespacesAndNewlines) : ""
}
let token = loadTokenFromKeychain()
guard !token.isEmpty else {
    log("FATAL: rainbow-control-token not in Keychain. Run services/control/install.sh.")
    exit(1)
}

// ─── HTTP types ─────────────────────────────────────────────────

struct HTTPRequest {
    let method: String
    let path: String
    let query: String
    let headers: [String: String]
    let body: Data
    func header(_ key: String) -> String? {
        headers[key.lowercased()]
    }
    func queryParam(_ key: String) -> String? {
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 && kv[0] == key { return kv[1].removingPercentEncoding ?? kv[1] }
            if kv.count == 1 && kv[0] == key { return "" }
        }
        return nil
    }
}

final class ResponseWriter {
    private let conn: NWConnection
    private let queue: DispatchQueue
    private var headersWritten = false
    private var ended = false
    private(set) var didStartSSE = false

    init(conn: NWConnection, queue: DispatchQueue) {
        self.conn = conn
        self.queue = queue
    }

    func writeHead(status: Int, headers: [String: String] = [:]) {
        guard !headersWritten else { return }
        headersWritten = true
        var line = "HTTP/1.1 \(status) \(reasonPhrase(status))\r\n"
        var hdrs = headers
        if hdrs["Content-Type"] == nil && !didStartSSE { hdrs["Content-Type"] = "application/json" }
        if hdrs["Connection"] == nil  { hdrs["Connection"] = "close" }
        for (k, v) in hdrs { line += "\(k): \(v)\r\n" }
        line += "\r\n"
        send(Data(line.utf8))
    }

    func writeJSON(_ status: Int, _ object: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        writeHead(status: status, headers: ["Content-Type": "application/json", "Content-Length": "\(data.count)"])
        send(data)
        end()
    }

    func writeText(_ status: Int, _ contentType: String, _ body: String) {
        let data = Data(body.utf8)
        writeHead(status: status, headers: [
            "Content-Type": contentType,
            "Content-Length": "\(data.count)",
        ])
        send(data)
        end()
    }

    func startSSE() {
        guard !headersWritten else { return }
        didStartSSE = true
        writeHead(status: 200, headers: [
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        ])
    }

    func sse(event: String, data: String) {
        var msg = "event: \(event)\ndata: \(data)\n\n"
        send(Data(msg.utf8))
        msg.removeAll()
    }

    func send(_ data: Data) {
        guard !ended else { return }
        conn.send(content: data, completion: .contentProcessed { _ in })
    }

    func end() {
        guard !ended else { return }
        ended = true
        conn.send(content: nil, isComplete: true, completion: .contentProcessed { _ in
            self.conn.cancel()
        })
    }

    private func reasonPhrase(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 404: return "Not Found"
        case 500: return "Internal Server Error"
        default:  return "OK"
        }
    }
}

// ─── HTTP parser ────────────────────────────────────────────────
// One-shot: accumulate buffer until \r\n\r\n is seen, parse, then read
// Content-Length more bytes for the body. Adequate for a daemon that
// handles low-volume local requests; not built for HTTP/1.1 keep-alive.

/// Active connections, keyed by ObjectIdentifier so we retain each
/// `Connection` instance until it finishes. Without this the local
/// reference inside `newConnectionHandler` goes out of scope and ARC
/// frees the Connection before its receive callback fires, leaving
/// curl hanging forever.
let activeConnections = NSMutableDictionary()
let activeConnectionsLock = NSLock()

func registerConnection(_ c: Connection) {
    activeConnectionsLock.lock()
    activeConnections[ObjectIdentifier(c).hashValue] = c
    activeConnectionsLock.unlock()
}
func unregisterConnection(_ c: Connection) {
    activeConnectionsLock.lock()
    activeConnections.removeObject(forKey: ObjectIdentifier(c).hashValue)
    activeConnectionsLock.unlock()
}

final class Connection {
    let conn: NWConnection
    let queue: DispatchQueue
    private var buffer = Data()
    private var headerEnd: Int? = nil
    private var contentLength: Int = 0
    private var headers: [String: String] = [:]
    private var requestLine: String = ""

    init(conn: NWConnection, queue: DispatchQueue) {
        self.conn = conn
        self.queue = queue
    }

    func start() {
        registerConnection(self)
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                if let self { unregisterConnection(self) }
            default: break
            }
        }
        conn.start(queue: queue)
        receive()
    }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.buffer.append(data) }
            if self.headerEnd == nil { self.tryParseHeaders() }
            if let end = self.headerEnd, self.buffer.count >= end + self.contentLength {
                self.dispatch()
                return
            }
            if error != nil || isComplete {
                self.conn.cancel()
                return
            }
            self.receive()
        }
    }

    private func tryParseHeaders() {
        let needle = Data("\r\n\r\n".utf8)
        guard let range = buffer.range(of: needle) else { return }
        let header = String(data: buffer.subdata(in: 0..<range.lowerBound), encoding: .utf8) ?? ""
        headerEnd = range.upperBound
        var lines = header.components(separatedBy: "\r\n")
        requestLine = lines.removeFirst()
        for line in lines {
            if let colon = line.firstIndex(of: ":") {
                let k = String(line[..<colon]).lowercased()
                let v = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
                headers[k] = v
            }
        }
        contentLength = Int(headers["content-length"] ?? "") ?? 0
    }

    private func dispatch() {
        let parts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { conn.cancel(); return }
        let method = parts[0]
        let target = parts[1]
        let split = target.split(separator: "?", maxSplits: 1).map(String.init)
        let path = split[0]
        let query = split.count > 1 ? split[1] : ""
        let bodyStart = headerEnd ?? buffer.count
        let bodyEnd = min(bodyStart + contentLength, buffer.count)
        let body = buffer.subdata(in: bodyStart..<bodyEnd)
        let req = HTTPRequest(method: method, path: path, query: query, headers: headers, body: body)
        let res = ResponseWriter(conn: conn, queue: queue)
        route(req, res)
    }
}

// ─── Auth + routes ──────────────────────────────────────────────

func authorized(_ req: HTTPRequest) -> Bool {
    guard let header = req.header("Authorization") else { return false }
    guard header.lowercased().hasPrefix("bearer ") else { return false }
    let presented = String(header.dropFirst(7)).trimmingCharacters(in: .whitespaces)
    return presented == token
}

func match(_ pattern: String, _ value: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
}

func route(_ req: HTTPRequest, _ res: ResponseWriter) {
    // /healthz — unauth liveness
    if req.method == "GET" && req.path == "/healthz" {
        res.writeJSON(200, ["status": "ok"])
        return
    }
    // /setup-progress — unauth landing page shown right after the .pkg
    // installer reports success. Polls /wizard-status until Phase B
    // writes .wizard-url, then redirects to the wizard.
    if req.method == "GET" && req.path == "/setup-progress" {
        res.writeText(200, "text/html; charset=utf-8", setupProgressHTML)
        return
    }
    // /wizard-status — unauth poll endpoint for the progress page.
    // Returns {ready: true, url: "..."} once .wizard-url exists.
    if req.method == "GET" && req.path == "/wizard-status" {
        handleWizardStatus(res: res)
        return
    }
    if !authorized(req) {
        res.writeJSON(401, ["error": "missing or invalid bearer token"])
        return
    }

    // POST /<action>/<container>
    if let m = req.path.matchPath(#"^/(start|stop|restart)/([^/?]+)$"#),
       req.method == "POST" {
        handleAction(action: m[1], name: m[2], res: res)
        return
    }

    // GET /logs/<container>
    if let m = req.path.matchPath(#"^/logs/([^/?]+)$"#),
       req.method == "GET" {
        let lines = Int(req.queryParam("lines") ?? "100") ?? 100
        handleLogs(name: m[1], lines: lines, res: res)
        return
    }

    // POST /run/<task>
    if let m = req.path.matchPath(#"^/run/([a-z-]+)$"#),
       req.method == "POST" {
        handleRun(task: m[1], res: res)
        return
    }

    // PUT /keychain/<service>
    if let m = req.path.matchPath(#"^/keychain/([^/?]+)$"#),
       req.method == "PUT" {
        handleKeychainPut(service: m[1], body: req.body, res: res)
        return
    }

    res.writeJSON(404, ["error": "no such route"])
}

extension String {
    /// Returns full match + capture groups if regex matches whole string.
    func matchPath(_ pattern: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: "^" + pattern.trimmingCharacters(in: CharacterSet(charactersIn: "^$")) + "$") else { return nil }
        let range = NSRange(self.startIndex..<self.endIndex, in: self)
        guard let m = regex.firstMatch(in: self, range: range) else { return nil }
        var captures: [String] = []
        for i in 0..<m.numberOfRanges {
            if let r = Range(m.range(at: i), in: self) {
                captures.append(String(self[r]))
            } else {
                captures.append("")
            }
        }
        return captures
    }
}

// ─── Action handlers ────────────────────────────────────────────

func handleAction(action: String, name: String, res: ResponseWriter) {
    guard validActions.contains(action) else {
        res.writeJSON(400, ["error": "unknown action: \(action)"])
        return
    }
    guard match(allowedContainerName, name) else {
        res.writeJSON(400, ["error": "name must match \(allowedContainerName) — refusing"])
        return
    }

    if action == "restart" {
        // Defer to orchestrator restart-container so fresh env from
        // Keychain + .env is picked up. A plain `container start`
        // reuses baked-in env from initial run.
        let recreate = runSync("/bin/bash", [orchestrator, "restart-container", name])
        var caddyRefresh: Any = NSNull()
        if recreate.exitCode == 0 {
            let r = runSync("/bin/bash", [refreshCaddy])
            caddyRefresh = ["ok": r.exitCode == 0]
        }
        let body: [String: Any] = [
            "action": "restart",
            "name": name,
            "recreate": ["code": recreate.exitCode, "stdout": recreate.stdout, "stderr": recreate.stderr],
            "caddyRefresh": caddyRefresh,
        ]
        res.writeJSON(recreate.exitCode == 0 ? 200 : 500, body)
        return
    }

    let result = runSync("container", [action, name])
    var caddyRefresh: Any = NSNull()
    if action == "start" && result.exitCode == 0 {
        let r = runSync("/bin/bash", [refreshCaddy])
        caddyRefresh = ["ok": r.exitCode == 0]
    }
    let body: [String: Any] = [
        "action": action,
        "name": name,
        "result": ["code": result.exitCode, "stdout": result.stdout, "stderr": result.stderr],
        "caddyRefresh": caddyRefresh,
    ]
    res.writeJSON(result.exitCode == 0 ? 200 : 500, body)
}

func handleLogs(name: String, lines: Int, res: ResponseWriter) {
    guard match(allowedContainerName, name) else {
        res.writeJSON(400, ["error": "name must match \(allowedContainerName) — refusing"])
        return
    }
    let max = Swift.max(1, Swift.min(lines, 5000))
    let result = runSync("container", ["logs", name])
    let combined = (result.stdout + result.stderr).split(separator: "\n", omittingEmptySubsequences: false)
    let tail = combined.suffix(max + 1)
    let body: [String: Any] = [
        "name": name,
        "lines": tail.count,
        "content": tail.joined(separator: "\n"),
    ]
    res.writeJSON(result.exitCode == 0 ? 200 : 500, body)
}

func handleRun(task: String, res: ResponseWriter) {
    guard let entry = allowedRunTasks[task] else {
        res.writeJSON(400, ["error": "unknown task: \(task)"])
        return
    }
    let scriptPath = "\(rainbowRoot)/\(entry.script)"
    var args = [scriptPath]
    if let a = entry.arg { args.append(a) }
    res.startSSE()
    res.sse(event: "started", data: "{\"task\":\"\(task)\"}")
    streamProcessAsSSE(executable: "/bin/bash", arguments: args, taskName: task, res: res)
}

func handleWizardStatus(res: ResponseWriter) {
    let urlPath = "\(rainbowRoot)/.wizard-url"
    if let raw = try? String(contentsOfFile: urlPath, encoding: .utf8) {
        let url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.isEmpty {
            res.writeJSON(200, ["ready": true, "url": url])
            return
        }
    }
    res.writeJSON(200, ["ready": false])
}

func handleKeychainPut(service: String, body: Data, res: ResponseWriter) {
    guard match(allowedKeychainName, service) else {
        res.writeJSON(400, ["error": "service must match \(allowedKeychainName)"])
        return
    }
    guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let value = json["value"] as? String, !value.isEmpty else {
        res.writeJSON(400, ["error": "missing 'value' field"])
        return
    }
    let result = runSync("/usr/bin/security",
                         ["add-generic-password", "-s", service, "-a", "rainbow", "-w", value, "-U"])
    if result.exitCode == 0 {
        res.writeJSON(200, ["ok": true, "service": service])
    } else {
        res.writeJSON(500, ["error": result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)])
    }
}

// ─── Subprocess helpers ─────────────────────────────────────────

struct ProcessResult { var exitCode: Int; var stdout: String; var stderr: String }

/// Synchronous run; captures all output. Adds Apple Container's typical
/// install path to PATH so we find `container` even if launchd's PATH is
/// stripped down.
func runSync(_ executable: String, _ args: [String]) -> ProcessResult {
    let p = Process()
    if executable.hasPrefix("/") {
        p.executableURL = URL(fileURLWithPath: executable)
        p.arguments = args
    } else {
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = [executable] + args
    }
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/Applications/Rainbow/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    env["RAINBOW_ROOT"] = rainbowRoot
    p.environment = env
    let outPipe = Pipe(); let errPipe = Pipe()
    p.standardOutput = outPipe; p.standardError = errPipe
    do {
        try p.run()
    } catch {
        return ProcessResult(exitCode: -1, stdout: "", stderr: String(describing: error))
    }
    let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
    let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return ProcessResult(
        exitCode: Int(p.terminationStatus),
        stdout: String(data: outData, encoding: .utf8) ?? "",
        stderr: String(data: errData, encoding: .utf8) ?? "")
}

/// Streams stdout + stderr from a long-running script as SSE `event: log`
/// messages, then emits `event: done` with the exit code. Lines are
/// tagged stdout/stderr in the JSON payload. Unbounded process — we
/// keep the connection open until the script exits.
func streamProcessAsSSE(executable: String, arguments: [String], taskName: String, res: ResponseWriter) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: executable)
    p.arguments = arguments
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/Applications/Rainbow/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    env["RAINBOW_ROOT"] = rainbowRoot
    p.environment = env

    let outPipe = Pipe(); let errPipe = Pipe()
    p.standardOutput = outPipe; p.standardError = errPipe

    var outBuf = Data(); var errBuf = Data()
    let lock = NSLock()

    func emitLines(stream: String, buffer: inout Data) {
        // emit complete lines, leave any partial behind
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: 0..<nl)
            buffer.removeSubrange(0...nl)
            let text = String(data: line, encoding: .utf8) ?? ""
            let payload: [String: Any] = ["stream": stream, "line": text]
            let json = (try? JSONSerialization.data(withJSONObject: payload))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            lock.lock(); res.sse(event: "log", data: json); lock.unlock()
        }
    }

    outPipe.fileHandleForReading.readabilityHandler = { fh in
        let chunk = fh.availableData
        if chunk.isEmpty { return }
        outBuf.append(chunk)
        emitLines(stream: "stdout", buffer: &outBuf)
    }
    errPipe.fileHandleForReading.readabilityHandler = { fh in
        let chunk = fh.availableData
        if chunk.isEmpty { return }
        errBuf.append(chunk)
        emitLines(stream: "stderr", buffer: &errBuf)
    }

    p.terminationHandler = { proc in
        outPipe.fileHandleForReading.readabilityHandler = nil
        errPipe.fileHandleForReading.readabilityHandler = nil
        // Flush any final partial lines.
        if !outBuf.isEmpty {
            outBuf.append(0x0A)
            emitLines(stream: "stdout", buffer: &outBuf)
        }
        if !errBuf.isEmpty {
            errBuf.append(0x0A)
            emitLines(stream: "stderr", buffer: &errBuf)
        }
        let donePayload: [String: Any] = ["task": taskName, "code": Int(proc.terminationStatus)]
        let json = (try? JSONSerialization.data(withJSONObject: donePayload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        lock.lock(); res.sse(event: "done", data: json); res.end(); lock.unlock()
    }

    do {
        try p.run()
    } catch {
        let json = "{\"task\":\"\(taskName)\",\"error\":\"\(error)\"}"
        res.sse(event: "error", data: json)
        res.end()
    }
}

// ─── Listener bootstrap ─────────────────────────────────────────

let params = NWParameters.tcp
params.allowLocalEndpointReuse = true
// Accept on all interfaces — the daemon binds on the default
// 0.0.0.0/:: so the rainbow-web container can reach it via
// host.docker.internal as well as the host itself via loopback.
let listener: NWListener
do {
    listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
} catch {
    log("FATAL: couldn't bind tcp/\(port): \(error)")
    exit(1)
}
listener.stateUpdateHandler = { state in
    switch state {
    case .failed(let err): log("listener failed: \(err)"); exit(1)
    default: break
    }
}
listener.newConnectionHandler = { conn in
    let q = DispatchQueue(label: "rainbow.control.conn")
    let handler = Connection(conn: conn, queue: q)
    handler.start()
}
let listenerQueue = DispatchQueue(label: "rainbow.control.listener")
listener.start(queue: listenerQueue)

log("listening on :\(port)")

dispatchMain()
