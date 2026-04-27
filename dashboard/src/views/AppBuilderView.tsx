import { useState, useRef, useEffect } from "react";
import { ChatInterface } from "../components/ChatInterface";

interface AppEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  status: "running" | "stopped" | "building";
  created_at: string;
}

export function AppBuilderView() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    fetch("/api/apps")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setApps(data);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>App Builder</h1>
          <p style={{ color: "var(--text-dim)", marginTop: 4 }}>
            Describe an app in plain English and let AI build it for you.
          </p>
        </div>
        <button style={styles.createBtn} onClick={() => setShowChat(true)}>
          Build New App
        </button>
      </div>

      {showChat && (
        <div style={styles.chatContainer}>
          <div style={styles.chatHeader}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>What would you like to build?</h3>
            <button
              style={styles.closeBtn}
              onClick={() => setShowChat(false)}
            >
              Close
            </button>
          </div>
          <ChatInterface
            onAppCreated={(app) => {
              setApps((prev) => [app, ...prev]);
              setShowChat(false);
            }}
          />
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 16px" }}>Your Apps</h2>

      {apps.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={{ fontSize: 16, color: "var(--text-dim)" }}>No custom apps yet.</p>
          <p style={{ fontSize: 14, color: "var(--text-dim)", marginTop: 8 }}>
            Click "Build New App" to create your first app with AI.
          </p>
          <div style={styles.examples}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Example prompts:</p>
            <ul style={{ fontSize: 13, color: "var(--text-dim)", paddingLeft: 20 }}>
              <li>"Build a family recipe website where we can add and share recipes"</li>
              <li>"Create a party invitation page for my birthday on June 15th"</li>
              <li>"Make a simple link-in-bio page with my social media links"</li>
              <li>"Build a status page that shows which of my services are online"</li>
            </ul>
          </div>
        </div>
      ) : (
        <div style={styles.appGrid}>
          {apps.map((app) => (
            <div key={app.id} style={styles.appCard}>
              <div style={styles.appCardHeader}>
                <span style={{ fontWeight: 600 }}>{app.name}</span>
                <span style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: app.status === "running"
                    ? "rgba(34,197,94,0.15)"
                    : app.status === "building"
                    ? "rgba(234,179,8,0.15)"
                    : "rgba(139,143,163,0.15)",
                  color: app.status === "running"
                    ? "var(--green)"
                    : app.status === "building"
                    ? "var(--yellow)"
                    : "var(--text-dim)",
                }}>
                  {app.status}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 8 }}>
                {app.description}
              </p>
              <div style={styles.appCardFooter}>
                {app.url && (
                  <a href={app.url} target="_blank" rel="noopener noreferrer" style={styles.appLink}>
                    Open
                  </a>
                )}
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {new Date(app.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  createBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  chatContainer: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    marginBottom: 24,
    overflow: "hidden",
  },
  chatHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
  },
  closeBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text-dim)",
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  emptyState: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 32,
    textAlign: "center" as const,
  },
  examples: {
    marginTop: 24,
    padding: 16,
    background: "var(--bg)",
    borderRadius: "var(--radius)",
    textAlign: "left" as const,
  },
  appGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 12,
  },
  appCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: 16,
  },
  appCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  appCardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  },
  appLink: {
    color: "var(--accent)",
    fontSize: 13,
    textDecoration: "none",
    fontWeight: 500,
  },
};
