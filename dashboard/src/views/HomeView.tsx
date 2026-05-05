import { useEffect, useState } from "react";
import { ServiceCard } from "../components/ServiceCard";
import { HealthIndicator } from "../components/HealthIndicator";
import { MailConnectBanner } from "../components/MailConnectBanner";

interface Service {
  name: string;
  slug: string;
  displayName: string;
  url: string;
  healthy: boolean;
  status?: number;
}

// Slugs the four "Quick Actions" buttons map to. The actual URLs come
// from /api/services (correctly-built level-1 hostnames like
// aubrey-photos.rainbow.rocks). Frontend used to assemble them as
// `${slug}.${domain}` which produced the wrong shape.
const QUICK_ACTION_SLUGS = ["photos", "docs", "files", "mail"] as const;
const QUICK_ACTION_LABELS: Record<string, string> = {
  photos: "Upload Photos",
  docs: "New Document",
  files: "Browse Files",
  mail: "Check Email",
};

export function HomeView() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [domain, setDomain] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/services", { credentials: "same-origin" });
        if (r.status === 401) {
          // Dashboard's static HTML loads without auth, but every API
          // call is gated. If we don't have a session cookie yet, send
          // the user through the OIDC login flow now — they'll come
          // back here authenticated and the next render will show
          // real data instead of "unknown" rows.
          window.location.href = "/api/auth/login";
          return;
        }
        if (!r.ok) return;
        const data = (await r.json()) as { services: Service[] };
        if (cancelled) return;
        setServices(data.services);

        // Best-effort: derive the apex domain from any service URL.
        // Each is `https://<prefix>-<slug>.<zone>/...`, and the apex
        // is `<prefix>.<zone>` — strip "<slug>-" and the path/scheme.
        const sample = data.services.find((s) => s.url)?.url;
        if (sample) {
          try {
            const host = new URL(sample).host; // e.g. aubrey-photos.rainbow.rocks
            // Strip the "<slug>-" prefix to get aubrey.rainbow.rocks.
            // If host starts with "<svc.slug>-" for any service, drop it.
            const matchSvc = data.services.find(
              (s) => s.slug && host.startsWith(`${prefixOf(host, s.slug)}${s.slug}.`),
            );
            if (matchSvc) {
              const slugStart = host.indexOf(`-${matchSvc.slug}.`);
              if (slugStart > 0) {
                setDomain(host.slice(0, slugStart) + host.slice(host.indexOf(".", slugStart)));
              } else {
                setDomain(host);
              }
            } else {
              setDomain(host);
            }
          } catch {
            setDomain("");
          }
        }
      } catch {
        // Network error — leave services null; render shows a loading state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const list = services ?? [];
  const healthyCount = list.filter((s) => s.healthy).length;
  const bySlug: Record<string, Service> = Object.fromEntries(
    list.map((s) => [s.slug, s]),
  );

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <HealthIndicator
          healthy={healthyCount}
          total={list.length}
        />
      </div>

      {domain && (
        <div style={styles.domainBanner}>
          <span style={styles.domainLabel}>Your domain</span>
          <span style={styles.domainValue}>{domain}</span>
        </div>
      )}

      <MailConnectBanner />

      <h2 style={styles.sectionTitle}>Services</h2>
      <div style={styles.grid}>
        {list.map((svc) => (
          <ServiceCard
            key={svc.name}
            name={svc.displayName}
            status={svc.healthy ? "healthy" : "unhealthy"}
            type="docker"
            url={svc.url}
          />
        ))}
        {list.length === 0 && <span style={styles.subtle}>Loading services…</span>}
      </div>

      <h2 style={styles.sectionTitle}>Quick Actions</h2>
      <div style={styles.actions}>
        {QUICK_ACTION_SLUGS.map((slug) => {
          const svc = bySlug[slug];
          if (!svc) return null;
          return (
            <button
              key={slug}
              style={styles.actionButton}
              onClick={() => window.open(svc.url, "_blank", "noopener")}
            >
              {QUICK_ACTION_LABELS[slug]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Returns "" if the host doesn't start with any other service's prefix —
// helper for stripping a "<slug>-" prefix from a hostname.
function prefixOf(host: string, slug: string): string {
  const idx = host.indexOf(`-${slug}.`);
  if (idx <= 0) return "";
  return host.slice(0, idx + 1); // includes the trailing "-"
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "2rem",
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: "2rem",
    fontWeight: 400,
    margin: 0,
    color: "var(--text)",
  },
  domainBanner: {
    background: "var(--surface)",
    border: "1px solid var(--text)",
    padding: "0.85rem 1rem",
    marginBottom: "1.75rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  domainLabel: {
    fontFamily: "var(--font-body)",
    fontSize: "0.78rem",
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "var(--text-dim)",
  },
  domainValue: {
    fontFamily: "var(--font-mono, ui-monospace, SF Mono, Menlo, monospace)",
    fontSize: "0.95rem",
    color: "var(--text)",
  },
  sectionTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "1.4rem",
    fontWeight: 400,
    margin: "1.5rem 0 0.75rem",
    color: "var(--text)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  actionButton: {
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    padding: "0.65rem 1.1rem",
    border: "1px solid var(--text)",
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
  },
  subtle: {
    color: "var(--text-dim)",
    fontFamily: "var(--font-body)",
    fontSize: "0.9rem",
  },
};
