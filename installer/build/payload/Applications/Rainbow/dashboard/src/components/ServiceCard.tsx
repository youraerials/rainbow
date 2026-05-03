interface ServiceCardProps {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  type: "docker" | "native";
  url?: string;
}

export function ServiceCard({ name, status, type, url }: ServiceCardProps) {
  const statusColor = status === "healthy"
    ? "var(--green)"
    : status === "unhealthy"
    ? "var(--red)"
    : "var(--text-dim)";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
        cursor: url ? "pointer" : "default",
        transition: "all 0.15s",
      }}
      onClick={() => url && window.open(url, "_blank")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{name}</span>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
        }} />
      </div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 10,
        fontSize: 12,
        color: "var(--text-dim)",
      }}>
        <span>{type}</span>
        <span style={{ color: statusColor }}>{status}</span>
      </div>
    </div>
  );
}
