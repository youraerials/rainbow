import { useEffect, useState } from "react";

/**
 * Update banner — sits above the main content area. Polls
 * /api/updates/check on mount and every 30 minutes after that. Three
 * possible states surface as banners:
 *
 *  1. Rainbow update available — single-click "Update" runs the
 *     daemon's `upgrade` task via SSE, shows live progress, then
 *     reloads the page so the dashboard picks up the new build.
 *  2. Apple Container update available — needs sudo, so we just
 *     surface the upgrade command for the user to paste into a
 *     Terminal. Auto-elevation is a v2 problem.
 *  3. Daemon-reload pending — the prior upgrade replaced the daemon
 *     binary; the running daemon is still on the old code. One-click
 *     restart handled by POST /api/updates/reload-daemon.
 *
 * The component renders nothing while there's no update; in the happy
 * path users never see it.
 */

interface UpdateInfo {
  rainbow: {
    installedVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    releaseUrl: string;
    releaseName: string;
  };
  container: {
    installedVersion: string;
    pinnedVersion: string;
    hasUpdate: boolean;
  };
  daemonReloadPending: boolean;
}

const POLL_INTERVAL_MS = 30 * 60 * 1000;

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/updates/check");
      if (r.ok) setInfo((await r.json()) as UpdateInfo);
    } catch {
      // Network blip — try again next interval.
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  async function applyUpgrade() {
    setPhase("running");
    setLogLines([]);
    setErrorMsg(null);

    let r: Response;
    try {
      r = await fetch("/api/updates/apply", { method: "POST" });
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
      return;
    }
    if (!r.ok || !r.body) {
      setPhase("error");
      setErrorMsg(`Upgrade failed to start (HTTP ${r.status})`);
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sawDone = false;
    let sawError = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split(/\n\n/);
      buf = events.pop() ?? "";
      for (const ev of events) {
        const eventLine = ev.split("\n").find((l) => l.startsWith("event: "));
        const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
        const eventName = eventLine?.slice(7).trim() ?? "";
        const dataRaw = dataLine?.slice(6) ?? "";
        if (eventName === "log") {
          try {
            const data = JSON.parse(dataRaw) as { stream?: string; line?: string };
            if (data.line) setLogLines((prev) => [...prev.slice(-80), data.line!]);
          } catch {
            // not JSON — show raw
            setLogLines((prev) => [...prev.slice(-80), dataRaw]);
          }
        } else if (eventName === "done") {
          sawDone = true;
          try {
            const data = JSON.parse(dataRaw) as { code?: number };
            if (data.code !== 0) sawError = true;
          } catch {
            /* tolerate malformed done */
          }
        } else if (eventName === "error") {
          sawError = true;
          setErrorMsg(dataRaw);
        }
      }
    }

    if (sawError || !sawDone) {
      setPhase("error");
      if (!errorMsg) setErrorMsg("Upgrade did not complete cleanly. Check the install log.");
      return;
    }

    setPhase("done");
    // Refresh version info so the banner clears, then reload after a
    // beat so the dashboard picks up the new build's bundle.
    await refresh();
    setTimeout(() => window.location.reload(), 1500);
  }

  async function reloadDaemon() {
    try {
      await fetch("/api/updates/reload-daemon", { method: "POST" });
      // The daemon takes a couple seconds to restart; refresh after.
      setTimeout(refresh, 4000);
    } catch {
      // Fail quietly — the marker file lingers and the banner re-renders.
    }
  }

  if (!info) return null;

  // ─── Active upgrade: progress UI ───────────────────────────────
  if (phase === "running" || phase === "done" || phase === "error") {
    return (
      <div style={styles.banner}>
        <div style={styles.bannerContent}>
          <div>
            <strong>
              {phase === "running" && "Updating Rainbow…"}
              {phase === "done" && `Updated to ${info.rainbow.latestVersion}.`}
              {phase === "error" && "Update failed."}
            </strong>
            {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}
          </div>
          {phase === "done" && <span style={styles.subtle}>Reloading…</span>}
        </div>
        {logLines.length > 0 && (
          <pre style={styles.logBox}>
            {logLines.slice(-12).join("\n")}
          </pre>
        )}
      </div>
    );
  }

  // ─── Banner #1: Rainbow update available ───────────────────────
  if (info.rainbow.hasUpdate) {
    return (
      <div style={styles.banner}>
        <div style={styles.bannerContent}>
          <div>
            <strong>Rainbow {info.rainbow.latestVersion} available.</strong>{" "}
            <span style={styles.subtle}>
              Currently on {info.rainbow.installedVersion || "unknown"}.
            </span>{" "}
            <a href={info.rainbow.releaseUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
              What's new ↗
            </a>
          </div>
          <button onClick={applyUpgrade} style={styles.button}>
            Update
          </button>
        </div>
      </div>
    );
  }

  // ─── Banner #2: Daemon reload pending ──────────────────────────
  if (info.daemonReloadPending) {
    return (
      <div style={styles.banner}>
        <div style={styles.bannerContent}>
          <div>
            <strong>Control daemon needs a restart</strong>{" "}
            <span style={styles.subtle}>
              for the just-installed update to take effect.
            </span>
          </div>
          <button onClick={reloadDaemon} style={styles.button}>
            Restart daemon
          </button>
        </div>
      </div>
    );
  }

  // ─── Banner #3: Apple Container update available ───────────────
  if (info.container.hasUpdate) {
    const cmd =
      `curl -fsSL https://github.com/apple/container/releases/download/` +
      `${info.container.pinnedVersion}/container-${info.container.pinnedVersion}-installer-signed.pkg ` +
      `-o /tmp/container.pkg && sudo /usr/sbin/installer -pkg /tmp/container.pkg -target /`;
    return (
      <div style={styles.banner}>
        <div style={styles.bannerContent}>
          <div>
            <strong>Apple Container update recommended.</strong>{" "}
            <span style={styles.subtle}>
              You're on {info.container.installedVersion}; Rainbow expects {info.container.pinnedVersion}.
            </span>
          </div>
        </div>
        <p style={styles.subtle}>
          Run this in Terminal (sudo prompt — Apple Container's installer requires it):
        </p>
        <pre style={styles.logBox}>{cmd}</pre>
      </div>
    );
  }

  return null;
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    border: "1px solid var(--text)",
    background: "var(--surface)",
    padding: "0.85rem 1rem",
    marginBottom: "1.25rem",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    color: "var(--text)",
  },
  bannerContent: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    flexWrap: "wrap",
  },
  subtle: {
    color: "var(--text-dim)",
  },
  link: {
    color: "var(--text)",
    textDecoration: "underline",
  },
  button: {
    fontFamily: "var(--font-body)",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.04em",
    padding: "0.45rem 1rem",
    border: "1px solid var(--text)",
    background: "var(--text)",
    color: "var(--surface)",
    cursor: "pointer",
  },
  errorMsg: {
    marginTop: "0.4rem",
    color: "var(--error, #b00020)",
    fontSize: "0.85rem",
  },
  logBox: {
    marginTop: "0.75rem",
    padding: "0.6rem 0.75rem",
    background: "var(--surface-hover, #00000010)",
    border: "1px solid var(--border, #00000018)",
    borderRadius: 2,
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: "0.8rem",
    overflowX: "auto",
    whiteSpace: "pre",
    maxHeight: 200,
    overflowY: "auto",
  },
};
