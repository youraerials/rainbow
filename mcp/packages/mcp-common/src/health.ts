/**
 * Health check utilities for Rainbow services.
 */

import type { HealthStatus } from "./types.js";

export type { HealthStatus };

export async function checkHealth(
  service: string,
  url: string,
  timeoutMs = 5000
): Promise<HealthStatus> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      service,
      healthy: response.ok,
      latency_ms: Date.now() - start,
      message: response.ok ? "OK" : `HTTP ${response.status}`,
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      service,
      healthy: false,
      latency_ms: Date.now() - start,
      message: error instanceof Error ? error.message : "Unknown error",
      checked_at: new Date().toISOString(),
    };
  }
}
