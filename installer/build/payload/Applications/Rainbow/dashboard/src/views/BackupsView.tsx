import { useState, useEffect } from "react";

interface Backup {
  id: string;
  time: string;
  paths: number;
  size: string;
  tags: string[];
}

export function BackupsView() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [backing_up, setBackingUp] = useState(false);

  useEffect(() => {
    fetch("/api/backups")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBackups(data);
      })
      .catch(() => {});
  }, []);

  const runBackup = async () => {
    setBackingUp(true);
    try {
      await fetch("/api/backups/run", { method: "POST" });
    } catch {
      // handle error
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Backups</h1>
        <button
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius)",
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            opacity: backing_up ? 0.6 : 1,
          }}
          onClick={runBackup}
          disabled={backing_up}
        >
          {backing_up ? "Backing up..." : "Run Backup Now"}
        </button>
      </div>

      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 20,
        marginBottom: 24,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Backup Policy</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>7</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Daily snapshots</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>4</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Weekly snapshots</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>6</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Monthly snapshots</div>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Recent Backups</h2>

      {backups.length === 0 ? (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 32,
          textAlign: "center" as const,
          color: "var(--text-dim)",
        }}>
          No backups yet. Run your first backup or wait for the scheduled backup at 3 AM.
        </div>
      ) : (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}>
          {backups.map((backup, i) => (
            <div
              key={backup.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 20px",
                borderBottom: i < backups.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: 14,
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 13 }}>{backup.id.slice(0, 8)}</span>
              <span>{new Date(backup.time).toLocaleString()}</span>
              <span style={{ color: "var(--text-dim)" }}>{backup.size}</span>
              <button style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text)",
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}>
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
