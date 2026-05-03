import { useEffect, useState, FormEvent } from "react";

type Provider = "resend" | "postmark" | "ses" | "mailgun" | "smtp";
type Security = "tls" | "starttls" | "none";

interface Status {
  configured: boolean;
  provider?: Provider;
  host?: string;
  port?: number;
  security?: Security;
  username?: string;
  fromAddress?: string;
  fromName?: string;
  passwordHint?: string;
}

interface Preset {
  label: string;
  // What to fill in when this preset is selected
  host?: string;
  port?: number;
  security?: Security;
  usernameHint?: string;
  passwordHint?: string;
  helpUrl?: string;
  // One-line copy explaining what to plug in
  description: string;
}

const PRESETS: Record<Provider, Preset> = {
  resend: {
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    security: "tls",
    usernameHint: "resend",
    passwordHint: "re_xxx... (Resend API key)",
    helpUrl: "https://resend.com/api-keys",
    description:
      "Free 100/day, 3000/mo. Modern API. Add your domain at resend.com first; they’ll give you DKIM TXT records to publish.",
  },
  postmark: {
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    security: "starttls",
    usernameHint: "Server API token",
    passwordHint: "(same Server API token)",
    helpUrl: "https://account.postmarkapp.com/servers",
    description:
      "Excellent deliverability, $15/mo minimum. Username and password are both your Server API token.",
  },
  ses: {
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    security: "starttls",
    usernameHint: "SMTP user (NOT IAM user — generate SMTP creds)",
    passwordHint: "SMTP password from SES console",
    helpUrl: "https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html",
    description:
      "$0.10 per 1000 emails. Cheapest at scale, more setup. Verify your sending domain + region in the SES console first.",
  },
  mailgun: {
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    security: "starttls",
    usernameHint: "postmaster@<your-mailgun-domain>",
    passwordHint: "SMTP password from Mailgun console",
    helpUrl: "https://app.mailgun.com/app/sending/domains",
    description: "$35/mo for 50k emails. Use 'smtp.eu.mailgun.org' if your domain is on the EU region.",
  },
  smtp: {
    label: "Generic SMTP",
    description:
      "Any other provider that speaks SMTP submission. Plug in their host, port, and credentials manually.",
  },
};

const empty = {
  provider: "resend" as Provider,
  host: PRESETS.resend.host ?? "",
  port: PRESETS.resend.port ?? 587,
  security: (PRESETS.resend.security ?? "tls") as Security,
  username: "",
  password: "",
  fromAddress: "",
  fromName: "",
};

export function OutboundMailSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function refresh() {
    const r = await fetch("/api/admin/smarthost");
    if (r.ok) setStatus(await r.json());
  }

  useEffect(() => {
    void refresh();
  }, []);

  function selectProvider(p: Provider) {
    const preset = PRESETS[p];
    setForm((prev) => ({
      ...prev,
      provider: p,
      host: preset.host ?? "",
      port: preset.port ?? prev.port,
      security: preset.security ?? prev.security,
    }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const r = await fetch("/api/admin/smarthost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: data.error ?? `Save failed (HTTP ${r.status}).` });
        return;
      }
      setMsg({ kind: "ok", text: "Saved." });
      setForm((f) => ({ ...f, password: "" })); // clear from memory
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setMsg(null);
    setTesting(true);
    try {
      const r = await fetch("/api/admin/smarthost/test", { method: "POST" });
      const data = await r.json();
      if (data.ok) {
        setMsg({
          kind: "ok",
          text: `Test sent. Recipients accepted: ${(data.accepted ?? []).join(", ") || "none"}.`,
        });
      } else {
        setMsg({ kind: "err", text: data.error ?? `Test failed (HTTP ${r.status}).` });
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleClear() {
    if (!confirm("Remove the outbound SMTP config? Sending mail will stop working.")) {
      return;
    }
    const r = await fetch("/api/admin/smarthost", { method: "DELETE" });
    if (r.ok) {
      setMsg({ kind: "ok", text: "Removed." });
      setForm(empty);
      await refresh();
    } else {
      setMsg({ kind: "err", text: `Remove failed (HTTP ${r.status}).` });
    }
  }

  const preset = PRESETS[form.provider];
  const passwordPlaceholder = preset.passwordHint ?? "API key or password";
  const usernamePlaceholder = preset.usernameHint ?? "username";

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Outbound Mail (SMTP relay)</h2>

      <div style={styles.explainBox}>
        <p style={{ marginBottom: 10 }}>
          <strong>Why a relay?</strong> Mail you send <em>directly</em> from your
          home server lands in spam at most providers — your IP doesn't have a
          sending reputation, the reverse-DNS won't match your domain, and most
          residential IP ranges are pre-blocked by Gmail/Outlook regardless of
          how perfect the message is. Receiving works (we route through Cloudflare
          → tunnel → Stalwart) but sending realistically requires a relay.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Bring your own.</strong> Sign up with any of the providers
          below, paste their credentials here, and we'll route outbound through
          them. The relay handles DKIM signing and IP reputation. Your data and
          credentials stay on your server.
        </p>
      </div>

      <div style={styles.statusBar}>
        <span style={styles.statusLabel}>Status:</span>
        {status === null ? (
          <span style={{ color: "var(--text-dim)" }}>Loading…</span>
        ) : status.configured ? (
          <>
            <span style={styles.statusOk}>Configured</span>
            <code style={styles.tag}>
              {status.provider} · {status.host}:{status.port}
            </code>
            <code style={styles.tag}>…{status.passwordHint}</code>
            <button type="button" onClick={handleTest} style={styles.secondaryBtn} disabled={testing}>
              {testing ? "Sending…" : "Send test"}
            </button>
            <button type="button" onClick={handleClear} style={styles.dangerBtn}>
              Remove
            </button>
          </>
        ) : (
          <span style={styles.statusOff}>Not configured</span>
        )}
      </div>

      <form onSubmit={handleSave} style={styles.form}>
        <div style={styles.row}>
          <label style={styles.label}>Provider</label>
          <div style={styles.providerGrid}>
            {(Object.keys(PRESETS) as Provider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => selectProvider(p)}
                style={{
                  ...styles.providerChip,
                  ...(form.provider === p ? styles.providerChipActive : {}),
                }}
              >
                {PRESETS[p].label}
              </button>
            ))}
          </div>
          <div style={styles.providerNote}>
            {preset.description}
            {preset.helpUrl && (
              <>
                {" "}
                <a href={preset.helpUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
                  Get credentials →
                </a>
              </>
            )}
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.row}>
            <label style={styles.label}>Host</label>
            <input
              style={styles.input}
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="smtp.provider.com"
              required
            />
          </div>
          <div style={styles.row}>
            <label style={styles.label}>Port</label>
            <input
              style={styles.input}
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              required
            />
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Encryption</label>
          <div style={styles.providerGrid}>
            {(["tls", "starttls", "none"] as Security[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm({ ...form, security: s })}
                style={{
                  ...styles.providerChip,
                  ...(form.security === s ? styles.providerChipActive : {}),
                }}
              >
                {s === "tls" ? "Implicit TLS" : s === "starttls" ? "STARTTLS" : "None"}
              </button>
            ))}
          </div>
          <div style={styles.providerNote}>
            Implicit TLS = port 465. STARTTLS = port 587 (or 25). Use None only for testing.
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.row}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={usernamePlaceholder}
              autoComplete="off"
              required
            />
          </div>
          <div style={styles.row}>
            <label style={styles.label}>Password / API key</label>
            <input
              style={styles.input}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={passwordPlaceholder}
              autoComplete="off"
              required
            />
          </div>
        </div>

        <div style={styles.grid2}>
          <div style={styles.row}>
            <label style={styles.label}>From address</label>
            <input
              style={styles.input}
              type="email"
              value={form.fromAddress}
              onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
              placeholder="you@your-domain.com"
              required
            />
          </div>
          <div style={styles.row}>
            <label style={styles.label}>From name (optional)</label>
            <input
              style={styles.input}
              value={form.fromName}
              onChange={(e) => setForm({ ...form, fromName: e.target.value })}
              placeholder='"Your Name"'
            />
          </div>
        </div>

        <div style={styles.formActions}>
          <button
            type="submit"
            style={saving ? styles.primaryBtnDisabled : styles.primaryBtn}
            disabled={saving}
          >
            {saving ? "Saving…" : status?.configured ? "Update" : "Save"}
          </button>
        </div>
      </form>

      {msg && (
        <div style={msg.kind === "ok" ? styles.msgOk : styles.msgErr}>{msg.text}</div>
      )}

      <details style={styles.details}>
        <summary style={styles.summary}>Known limitations</summary>
        <ul style={styles.limitations}>
          <li>
            <strong>Snappymail submission isn't routed yet.</strong> Sending mail
            from the webmail UI requires Stalwart's outbound queue to relay through
            this smarthost — that wiring is on the roadmap and isn't automated yet.
            For now, sending from MCP tools / generated apps works.
          </li>
          <li>
            <strong>Direct outbound (no relay) is unsupported.</strong> Stalwart
            can do it in principle but deliverability from a residential IP is too
            unreliable to recommend.
          </li>
          <li>
            <strong>You publish the relay's DNS records yourself.</strong> Resend /
            Postmark / etc. give you DKIM + SPF TXT records when you add a domain;
            create them in your Cloudflare zone for proper From-domain alignment.
            Auto-publishing via our Cloudflare API token is on the roadmap.
          </li>
        </ul>
      </details>
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
    marginBottom: 12,
  },
  explainBox: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-dim)",
    marginBottom: 16,
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    padding: "10px 14px",
    background: "var(--bg)",
    borderRadius: "var(--radius)",
    marginBottom: 16,
  },
  statusLabel: { fontSize: 13, color: "var(--text-dim)" },
  statusOk: { fontSize: 13, color: "var(--green)", fontWeight: 600 },
  statusOff: { fontSize: 13, color: "var(--text-dim)" },
  tag: {
    fontSize: 12,
    background: "var(--surface)",
    padding: "2px 8px",
    borderRadius: 4,
    fontFamily: "monospace",
  },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "flex", flexDirection: "column", gap: 6 },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    fontFamily: "monospace",
  },
  providerGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  providerChip: {
    background: "var(--bg)",
    color: "var(--text-dim)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  providerChipActive: {
    background: "var(--accent)",
    color: "#fff",
    borderColor: "var(--accent)",
  },
  providerNote: {
    fontSize: 12,
    color: "var(--text-dim)",
    marginTop: 6,
    lineHeight: 1.5,
  },
  link: { color: "var(--accent)", textDecoration: "none" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
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
  secondaryBtn: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
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
  msgOk: { marginTop: 12, fontSize: 13, color: "var(--green)" },
  msgErr: { marginTop: 12, fontSize: 13, color: "var(--red)" },
  details: { marginTop: 16, fontSize: 13 },
  summary: {
    cursor: "pointer",
    color: "var(--text-dim)",
    padding: "6px 0",
  },
  limitations: {
    color: "var(--text-dim)",
    paddingLeft: 20,
    marginTop: 8,
    lineHeight: 1.6,
  },
};
