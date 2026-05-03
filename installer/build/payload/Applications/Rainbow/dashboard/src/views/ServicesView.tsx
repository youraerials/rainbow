import { useState } from "react";

interface Service {
  name: string;
  displayName: string;
  description: string;
  type: "docker" | "native";
  enabled: boolean;
}

const allServices: Service[] = [
  { name: "authentik", displayName: "Authentik", description: "Identity & single sign-on", type: "docker", enabled: true },
  { name: "immich", displayName: "Immich", description: "Photos & video management", type: "docker", enabled: true },
  { name: "stalwart", displayName: "Stalwart", description: "Email, calendar, contacts", type: "native", enabled: true },
  { name: "seafile", displayName: "Seafile", description: "File sharing & sync", type: "docker", enabled: true },
  { name: "cryptpad", displayName: "CryptPad", description: "Collaborative documents", type: "docker", enabled: true },
  { name: "jellyfin", displayName: "Jellyfin", description: "Media server with transcoding", type: "native", enabled: true },
  { name: "minecraft", displayName: "Minecraft", description: "Paper game server", type: "native", enabled: false },
];

export function ServicesView() {
  const [services] = useState(allServices);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const handleAction = async (service: string, action: "start" | "stop" | "restart") => {
    setActionInProgress(`${service}-${action}`);
    try {
      await fetch(`/api/services/${service}/${action}`, { method: "POST" });
    } catch {
      // Handle error
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Services</h1>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ flex: 2 }}>Service</span>
          <span style={{ flex: 3 }}>Description</span>
          <span style={{ flex: 1 }}>Type</span>
          <span style={{ flex: 1 }}>Status</span>
          <span style={{ flex: 2, textAlign: "right" }}>Actions</span>
        </div>

        {services.map((svc) => (
          <div key={svc.name} style={styles.tableRow}>
            <span style={{ flex: 2, fontWeight: 600 }}>{svc.displayName}</span>
            <span style={{ flex: 3, color: "var(--text-dim)" }}>{svc.description}</span>
            <span style={{ flex: 1 }}>
              <span style={{
                ...styles.badge,
                background: svc.type === "docker" ? "rgba(99,102,241,0.15)" : "rgba(234,179,8,0.15)",
                color: svc.type === "docker" ? "var(--accent)" : "var(--yellow)",
              }}>
                {svc.type}
              </span>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{
                ...styles.badge,
                background: svc.enabled ? "rgba(34,197,94,0.15)" : "rgba(139,143,163,0.15)",
                color: svc.enabled ? "var(--green)" : "var(--text-dim)",
              }}>
                {svc.enabled ? "enabled" : "disabled"}
              </span>
            </span>
            <span style={{ flex: 2, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={styles.btn}
                disabled={actionInProgress !== null}
                onClick={() => handleAction(svc.name, "start")}
              >
                {actionInProgress === `${svc.name}-start` ? "..." : "Start"}
              </button>
              <button
                style={styles.btn}
                disabled={actionInProgress !== null}
                onClick={() => handleAction(svc.name, "stop")}
              >
                {actionInProgress === `${svc.name}-stop` ? "..." : "Stop"}
              </button>
              <button
                style={styles.btn}
                disabled={actionInProgress !== null}
                onClick={() => handleAction(svc.name, "restart")}
              >
                {actionInProgress === `${svc.name}-restart` ? "..." : "Restart"}
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  table: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    overflow: "hidden",
  },
  tableHeader: {
    display: "flex",
    padding: "12px 20px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: "1px solid var(--border)",
  },
  tableRow: {
    display: "flex",
    alignItems: "center",
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
    fontSize: 14,
  },
  badge: {
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
  },
  btn: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
};
