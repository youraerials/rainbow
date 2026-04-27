import { useEffect, useState } from "react";
import { ServiceCard } from "../components/ServiceCard";
import { HealthIndicator } from "../components/HealthIndicator";

interface ServiceStatus {
  name: string;
  displayName: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  type: "docker" | "native";
}

const defaultServices: ServiceStatus[] = [
  { name: "caddy", displayName: "Caddy", url: "", status: "unknown", type: "docker" },
  { name: "authentik", displayName: "Auth", url: "/auth", status: "unknown", type: "docker" },
  { name: "immich", displayName: "Photos", url: "/photos", status: "unknown", type: "docker" },
  { name: "stalwart", displayName: "Email", url: "/mail", status: "unknown", type: "native" },
  { name: "seafile", displayName: "Files", url: "/files", status: "unknown", type: "docker" },
  { name: "cryptpad", displayName: "Docs", url: "/docs", status: "unknown", type: "docker" },
  { name: "jellyfin", displayName: "Media", url: "/media", status: "unknown", type: "native" },
];

export function HomeView() {
  const [services, setServices] = useState<ServiceStatus[]>(defaultServices);
  const [domain, setDomain] = useState("localhost");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.domain) setDomain(data.domain);
        if (data.services) {
          setServices((prev) =>
            prev.map((svc) => {
              const remote = data.services.find(
                (s: { name: string }) => s.name === svc.name
              );
              return remote ? { ...svc, status: remote.healthy ? "healthy" : "unhealthy" } : svc;
            })
          );
        }
      })
      .catch(() => {
        // API not available yet
      });
  }, []);

  const healthyCount = services.filter((s) => s.status === "healthy").length;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <HealthIndicator
          healthy={healthyCount}
          total={services.length}
        />
      </div>

      <div style={styles.domainBanner}>
        <span style={styles.domainLabel}>Your domain</span>
        <span style={styles.domainValue}>{domain}</span>
      </div>

      <h2 style={styles.sectionTitle}>Services</h2>
      <div style={styles.grid}>
        {services.map((svc) => (
          <ServiceCard
            key={svc.name}
            name={svc.displayName}
            status={svc.status}
            type={svc.type}
            url={svc.url ? `https://${svc.url.slice(1)}.${domain}` : undefined}
          />
        ))}
      </div>

      <h2 style={styles.sectionTitle}>Quick Actions</h2>
      <div style={styles.actions}>
        <button style={styles.actionButton} onClick={() => window.open(`https://photos.${domain}`)}>
          Upload Photos
        </button>
        <button style={styles.actionButton} onClick={() => window.open(`https://docs.${domain}`)}>
          New Document
        </button>
        <button style={styles.actionButton} onClick={() => window.open(`https://files.${domain}`)}>
          Browse Files
        </button>
        <button style={styles.actionButton} onClick={() => window.open(`https://mail.${domain}`)}>
          Check Email
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
  },
  domainBanner: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "16px 20px",
    marginBottom: 32,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  domainLabel: {
    color: "var(--text-dim)",
    fontSize: 14,
  },
  domainValue: {
    color: "var(--accent)",
    fontWeight: 600,
    fontSize: 16,
    fontFamily: "monospace",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 16,
    color: "var(--text)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    marginBottom: 32,
  },
  actions: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  actionButton: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 20px",
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.15s",
  },
};
