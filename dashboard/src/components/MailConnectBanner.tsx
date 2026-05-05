import { useEffect, useState } from "react";

/**
 * Mail connect banner — shows when Stalwart is up but rainbow-web
 * doesn't have JMAP creds, so the email/calendar/contacts MCP tools
 * can't talk to it. The user finishes Stalwart's web wizard (separate
 * tab, can't be automated — interactive password setup), then comes
 * back here and connects.
 *
 * On submit we POST to /api/admin/stalwart/connect, which validates the
 * creds against Stalwart's JMAP session endpoint, writes both Keychain
 * entries via the host control daemon, then restarts rainbow-web so
 * the new env vars take effect. The page disappears once /status
 * reports `connected: true`.
 */

interface Status {
  connected: boolean;
  user: string | null;
}

export function MailConnectBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/admin/stalwart/status", {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const data = (await r.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        // Silent — banner just doesn't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/stalwart/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!r.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setSuccess(true);
      // Optimistic: hide the banner after a short delay so the user
      // sees confirmation, then the next /status poll on a real
      // navigation confirms.
      setTimeout(() => {
        setStatus({ connected: true, user });
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!status || status.connected) return null;

  return (
    <div style={styles.banner}>
      <div style={styles.row}>
        <div>
          <div style={styles.eyebrow}>Mail</div>
          <div style={styles.headline}>Connect your mailbox</div>
          <p style={styles.body}>
            Finish Stalwart's first-run setup in the Mail tab, then enter
            the JMAP login you created so Rainbow's email, calendar, and
            contacts tools can read it.
          </p>
        </div>
        {!open && !success && (
          <button style={styles.primary} onClick={() => setOpen(true)}>
            Connect
          </button>
        )}
      </div>

      {success && (
        <div style={styles.success}>
          Connected as <strong>{user}</strong>. Restarting the web tier — this
          page will pick up the change in a moment.
        </div>
      )}

      {open && !success && (
        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            <span style={styles.labelText}>JMAP user (email)</span>
            <input
              type="email"
              required
              autoComplete="username"
              autoFocus
              value={user}
              onChange={(e) => setUser(e.target.value)}
              style={styles.input}
              placeholder="you@yourdomain.com"
              disabled={submitting}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              disabled={submitting}
            />
          </label>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.formRow}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              style={styles.secondary}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" style={styles.primary} disabled={submitting}>
              {submitting ? "Validating…" : "Connect"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    border: "1px solid var(--text)",
    background: "var(--surface)",
    padding: "1rem 1.1rem",
    marginBottom: "1.75rem",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
  },
  eyebrow: {
    fontFamily: "var(--font-body)",
    fontSize: "0.74rem",
    fontWeight: 600,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "var(--text-dim)",
    marginBottom: "0.25rem",
  },
  headline: {
    fontFamily: "var(--font-display)",
    fontSize: "1.25rem",
    fontWeight: 400,
    color: "var(--text)",
    marginBottom: "0.4rem",
  },
  body: {
    color: "var(--text-dim)",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    margin: 0,
    maxWidth: "44rem",
  },
  primary: {
    background: "var(--accent)",
    color: "var(--bg)",
    border: "1px solid var(--text)",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    padding: "0.55rem 1rem",
    cursor: "pointer",
    flexShrink: 0,
  },
  secondary: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--text)",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    padding: "0.55rem 1rem",
    cursor: "pointer",
  },
  form: {
    marginTop: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    maxWidth: "32rem",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  labelText: {
    fontFamily: "var(--font-body)",
    fontSize: "0.82rem",
    color: "var(--text-dim)",
  },
  input: {
    fontFamily: "var(--font-body)",
    fontSize: "0.95rem",
    padding: "0.55rem 0.7rem",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
  },
  formRow: {
    display: "flex",
    gap: "0.6rem",
    justifyContent: "flex-end",
  },
  error: {
    color: "var(--red)",
    fontFamily: "var(--font-body)",
    fontSize: "0.88rem",
  },
  success: {
    marginTop: "0.75rem",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    color: "var(--green)",
  },
};
