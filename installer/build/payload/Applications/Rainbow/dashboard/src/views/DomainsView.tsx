import { useState } from "react";

export function DomainsView() {
  const [subdomain, setSubdomain] = useState("");
  const [checkResult, setCheckResult] = useState<{ available: boolean; domain: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const checkAvailability = async () => {
    if (!subdomain.trim()) return;
    setChecking(true);
    try {
      const resp = await fetch(`/api/domains/check/${subdomain.toLowerCase()}`);
      const data = await resp.json();
      setCheckResult(data);
    } catch {
      setCheckResult(null);
    } finally {
      setChecking(false);
    }
  };

  const subdomains = [
    { prefix: "app", label: "Dashboard" },
    { prefix: "photos", label: "Photos" },
    { prefix: "mail", label: "Email" },
    { prefix: "files", label: "Files" },
    { prefix: "docs", label: "Documents" },
    { prefix: "media", label: "Media" },
    { prefix: "auth", label: "Auth" },
    { prefix: "api", label: "API" },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Domains</h1>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Check Subdomain Availability</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={styles.inputGroup}>
            <input
              type="text"
              placeholder="yourname"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && checkAvailability()}
              style={styles.input}
            />
            <span style={styles.inputSuffix}>.rainbow.rocks</span>
          </div>
          <button
            style={styles.checkBtn}
            onClick={checkAvailability}
            disabled={checking || !subdomain.trim()}
          >
            {checking ? "Checking..." : "Check"}
          </button>
        </div>

        {checkResult && (
          <div style={{
            marginTop: 12,
            padding: "10px 16px",
            borderRadius: "var(--radius)",
            background: checkResult.available ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            color: checkResult.available ? "var(--green)" : "var(--red)",
            fontSize: 14,
          }}>
            {checkResult.available
              ? `${checkResult.domain} is available!`
              : `${checkResult.domain} is already taken.`}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Service Subdomains</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 16 }}>
          These subdomains are automatically created when you claim a domain.
        </p>
        <div style={styles.subdomainGrid}>
          {subdomains.map((sd) => (
            <div key={sd.prefix} style={styles.subdomainCard}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{sd.label}</span>
              <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-dim)" }}>
                {sd.prefix}.yourdomain.rainbow.rocks
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Custom Domain</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14 }}>
          You can also use your own domain. Add it to Cloudflare, then configure CNAME records
          pointing to your Cloudflare Tunnel. See the{" "}
          <a href="/docs/networking" style={{ color: "var(--accent)" }}>networking docs</a> for details.
        </p>
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
  inputGroup: {
    display: "flex",
    alignItems: "center",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    flex: 1,
  },
  input: {
    background: "transparent",
    border: "none",
    color: "var(--text)",
    padding: "10px 14px",
    fontSize: 16,
    fontFamily: "monospace",
    flex: 1,
    outline: "none",
  },
  inputSuffix: {
    color: "var(--text-dim)",
    padding: "0 14px",
    fontSize: 16,
    fontFamily: "monospace",
    whiteSpace: "nowrap" as const,
  },
  checkBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  subdomainGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 8,
  },
  subdomainCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "var(--bg)",
    borderRadius: "var(--radius)",
  },
};
