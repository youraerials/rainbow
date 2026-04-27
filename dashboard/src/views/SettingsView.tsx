export function SettingsView() {
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>General</h2>
        <div style={styles.setting}>
          <div>
            <div style={styles.settingLabel}>Domain</div>
            <div style={styles.settingDesc}>Your primary domain for all services</div>
          </div>
          <code style={styles.settingValue}>mydomain.rainbow.rocks</code>
        </div>
        <div style={styles.setting}>
          <div>
            <div style={styles.settingLabel}>Admin Email</div>
            <div style={styles.settingDesc}>Used for service admin accounts and notifications</div>
          </div>
          <code style={styles.settingValue}>admin@mydomain.rainbow.rocks</code>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Configuration</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 16 }}>
          All settings are managed in <code style={styles.code}>config/rainbow.yaml</code>.
          Edit the file and run <code style={styles.code}>rainbow config apply</code> to update.
        </p>
        <div style={styles.commandBox}>
          <code>rainbow config edit</code>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Open config in your editor</span>
        </div>
        <div style={styles.commandBox}>
          <code>rainbow config apply</code>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Regenerate and apply configs</span>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Secrets</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 16 }}>
          All secrets are stored in the macOS Keychain. They are never written to disk in plaintext.
        </p>
        <div style={styles.secretsList}>
          {[
            "postgres-password",
            "authentik-secret",
            "authentik-bootstrap-password",
            "stalwart-admin-password",
            "seafile-admin-password",
            "cloudflare-tunnel-token",
            "restic-password",
          ].map((key) => (
            <div key={key} style={styles.secretRow}>
              <code style={{ fontSize: 13 }}>rainbow-{key}</code>
              <span style={{
                fontSize: 12,
                color: "var(--green)",
                background: "rgba(34,197,94,0.1)",
                padding: "2px 8px",
                borderRadius: 4,
              }}>
                stored
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>System</h2>
        <div style={styles.commandBox}>
          <code>rainbow update</code>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Pull latest images and restart</span>
        </div>
        <div style={{ ...styles.commandBox, borderColor: "var(--red)" }}>
          <code style={{ color: "var(--red)" }}>make reset</code>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Stop all services and delete data (destructive)</span>
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
    marginBottom: 16,
  },
  setting: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  },
  settingLabel: {
    fontWeight: 500,
    fontSize: 14,
  },
  settingDesc: {
    color: "var(--text-dim)",
    fontSize: 13,
    marginTop: 2,
  },
  settingValue: {
    background: "var(--bg)",
    padding: "4px 10px",
    borderRadius: 4,
    fontSize: 13,
  },
  code: {
    background: "var(--bg)",
    padding: "1px 6px",
    borderRadius: 3,
    fontSize: 13,
  },
  commandBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "12px 16px",
    marginBottom: 8,
  },
  secretsList: {
    display: "flex",
    flexDirection: "column" as const,
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
};
