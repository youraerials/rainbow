import { useEffect, useState, FormEvent } from "react";
import { OutboundMailSettings } from "./OutboundMailSettings";

interface KeyStatus {
  configured: boolean;
  suffix: string | null;
}

interface VersionInfo {
  rainbow: { installedVersion: string; latestVersion: string; hasUpdate: boolean };
  container: { installedVersion: string; pinnedVersion: string };
}

export function SettingsView() {
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<VersionInfo | null>(null);

  async function refreshKey() {
    const resp = await fetch("/api/admin/anthropic-key");
    if (resp.ok) {
      setKeyStatus(await resp.json());
    }
  }

  async function refreshVersion() {
    try {
      const resp = await fetch("/api/updates/check");
      if (resp.ok) setVersion((await resp.json()) as VersionInfo);
    } catch {
      // Silently leave version null — section just doesn't render.
    }
  }

  useEffect(() => {
    void refreshKey();
    void refreshVersion();
  }, []);

  async function handleSaveKey(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setKeyMsg(null);
    if (!keyInput.startsWith("sk-")) {
      setKeyMsg({ kind: "err", text: "Anthropic keys start with 'sk-'." });
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/anthropic-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setKeyMsg({
          kind: "err",
          text: data.error ?? `Save failed (HTTP ${resp.status}).`,
        });
        return;
      }
      setKeyInput("");
      setKeyMsg({ kind: "ok", text: `Saved (ends in ${data.suffix}).` });
      await refreshKey();
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    if (!confirm("Remove the Anthropic API key? App generation will stop working."))
      return;
    const resp = await fetch("/api/admin/anthropic-key", { method: "DELETE" });
    if (resp.ok) {
      setKeyMsg({ kind: "ok", text: "Key removed." });
      await refreshKey();
    } else {
      setKeyMsg({ kind: "err", text: `Remove failed (HTTP ${resp.status}).` });
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      {version && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>About</h2>
          <div style={styles.versionRow}>
            <span style={styles.versionLabel}>Rainbow</span>
            <code style={styles.versionValue}>
              {version.rainbow.installedVersion || "unknown"}
            </code>
            {version.rainbow.hasUpdate && (
              <span style={styles.versionBadge}>
                {version.rainbow.latestVersion} available
              </span>
            )}
          </div>
          <div style={styles.versionRow}>
            <span style={styles.versionLabel}>Apple Container</span>
            <code style={styles.versionValue}>
              {version.container.installedVersion || "unknown"}
            </code>
            {version.container.pinnedVersion &&
              version.container.installedVersion !==
                version.container.pinnedVersion && (
                <span style={styles.versionBadge}>
                  pinned {version.container.pinnedVersion}
                </span>
              )}
          </div>
        </div>
      )}

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Anthropic API Key</h2>
        <p style={styles.sectionDesc}>
          Used by the App Builder to generate new apps. Stored in Postgres
          (rainbow_web.web_config) — never written to disk in plaintext outside
          the database. Get a key at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.link}
          >
            console.anthropic.com
          </a>
          .
        </p>

        <div style={styles.keyStatus}>
          <span style={styles.statusLabel}>Status:</span>
          {keyStatus === null ? (
            <span style={{ color: "var(--text-dim)" }}>Loading…</span>
          ) : keyStatus.configured ? (
            <>
              <span style={styles.statusOk}>Configured</span>
              <code style={styles.suffixTag}>…{keyStatus.suffix}</code>
              <button
                type="button"
                onClick={handleClearKey}
                style={styles.dangerBtn}
              >
                Remove
              </button>
            </>
          ) : (
            <span style={styles.statusOff}>Not configured</span>
          )}
        </div>

        <form onSubmit={handleSaveKey} style={styles.keyForm}>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={styles.input}
            autoComplete="off"
          />
          <button
            type="submit"
            style={saving || !keyInput ? styles.primaryBtnDisabled : styles.primaryBtn}
            disabled={saving || !keyInput}
          >
            {saving ? "Saving…" : keyStatus?.configured ? "Replace" : "Save"}
          </button>
        </form>
        {keyMsg && (
          <div
            style={
              keyMsg.kind === "ok" ? styles.msgOk : styles.msgErr
            }
          >
            {keyMsg.text}
          </div>
        )}
      </div>

      <OutboundMailSettings />

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Configuration</h2>
        <p style={styles.sectionDesc}>
          All other settings live in <code style={styles.code}>config/rainbow.yaml</code>.
          Edit the file and run <code style={styles.code}>make config</code> + {" "}
          <code style={styles.code}>make start</code> to apply.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Secrets</h2>
        <p style={styles.sectionDesc}>
          Service credentials live in the macOS Keychain on the host. The
          orchestrator reads them and injects them as env vars into the
          relevant containers.
        </p>
        <div style={styles.secretsList}>
          {[
            "postgres-password",
            "mariadb-root-password",
            "authentik-secret",
            "authentik-bootstrap-password",
            "seafile-admin-password",
            "cloudflare-tunnel-token",
            "control-token",
          ].map((key) => (
            <div key={key} style={styles.secretRow}>
              <code style={{ fontSize: 13 }}>rainbow-{key}</code>
              <span style={styles.secretBadge}>stored</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 8,
  },
  sectionDesc: {
    color: "var(--text-dim)",
    fontSize: 14,
    marginBottom: 16,
  },
  link: {
    color: "var(--accent)",
    textDecoration: "none",
  },
  keyStatus: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "var(--bg)",
    borderRadius: "var(--radius)",
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 13,
    color: "var(--text-dim)",
  },
  statusOk: {
    fontSize: 13,
    color: "var(--green)",
    fontWeight: 600,
  },
  statusOff: {
    fontSize: 13,
    color: "var(--text-dim)",
  },
  suffixTag: {
    fontSize: 12,
    background: "var(--surface)",
    padding: "2px 8px",
    borderRadius: 4,
  },
  keyForm: {
    display: "flex",
    gap: 8,
  },
  input: {
    flex: 1,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    fontFamily: "monospace",
  },
  primaryBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnDisabled: {
    background: "var(--surface)",
    color: "var(--text-dim)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "not-allowed",
  },
  dangerBtn: {
    background: "transparent",
    color: "var(--red)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    marginLeft: "auto",
  },
  msgOk: {
    marginTop: 12,
    fontSize: 13,
    color: "var(--green)",
  },
  msgErr: {
    marginTop: 12,
    fontSize: 13,
    color: "var(--red)",
  },
  code: {
    background: "var(--bg)",
    padding: "1px 6px",
    borderRadius: 3,
    fontSize: 13,
  },
  secretsList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  secretRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "var(--bg)",
    borderRadius: "var(--radius)",
  },
  secretBadge: {
    fontSize: 12,
    color: "var(--green)",
    background: "rgba(34,197,94,0.1)",
    padding: "2px 8px",
    borderRadius: 4,
  },
  versionRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    background: "var(--bg)",
    borderRadius: "var(--radius)",
    marginBottom: 6,
  },
  versionLabel: {
    fontSize: 13,
    color: "var(--text-dim)",
    minWidth: 140,
  },
  versionValue: {
    fontSize: 13,
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    color: "var(--text)",
  },
  versionBadge: {
    fontSize: 11,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    padding: "2px 8px",
    borderRadius: 4,
    letterSpacing: "0.04em",
    marginLeft: "auto",
  },
};
