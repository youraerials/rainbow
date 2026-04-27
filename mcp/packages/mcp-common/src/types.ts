/**
 * Shared types for Rainbow MCP servers.
 */

export interface RainbowConfig {
  rainbow: { version: string };
  domain: { primary: string };
  cloudflare: {
    zone_id: string;
    tunnel_id: string;
  };
  admin: {
    name: string;
    email: string;
  };
  services: Record<string, ServiceConfig>;
  backups: {
    enabled: boolean;
    schedule: string;
    repository: string;
    retention: {
      keep_daily: number;
      keep_weekly: number;
      keep_monthly: number;
    };
  };
  ai: {
    enabled: boolean;
    model: string;
  };
}

export interface ServiceConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface HealthStatus {
  service: string;
  healthy: boolean;
  latency_ms: number;
  message?: string;
  checked_at: string;
}
