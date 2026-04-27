interface HealthIndicatorProps {
  healthy: number;
  total: number;
}

export function HealthIndicator({ healthy, total }: HealthIndicatorProps) {
  const allHealthy = healthy === total;
  const color = allHealthy ? "var(--green)" : healthy > 0 ? "var(--yellow)" : "var(--red)";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 20,
      fontSize: 13,
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
      }} />
      <span style={{ color: "var(--text-dim)" }}>
        {healthy}/{total} services
      </span>
    </div>
  );
}
