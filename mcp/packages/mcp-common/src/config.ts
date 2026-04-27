/**
 * Configuration utilities for MCP servers.
 * Reads rainbow.yaml and provides service URLs.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { RainbowConfig } from "./types.js";

const CONFIG_PATHS = [
  process.env.RAINBOW_CONFIG || "",
  "/opt/rainbow/config/rainbow.yaml",
  "./config/rainbow.yaml",
];

let cachedConfig: RainbowConfig | null = null;

export function loadConfig(): RainbowConfig {
  if (cachedConfig) return cachedConfig;

  for (const path of CONFIG_PATHS) {
    if (!path) continue;
    try {
      const content = readFileSync(path, "utf-8");
      cachedConfig = parse(content) as RainbowConfig;
      return cachedConfig;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not find rainbow.yaml. Set RAINBOW_CONFIG env var or place it in ./config/"
  );
}

/**
 * Service URL routing map.
 * Maps service names to their internal URLs.
 */
const SERVICE_URLS: Record<string, string> = {
  immich: "http://localhost:2283",
  stalwart: "http://localhost:8080",
  seafile: "http://localhost:8082",
  cryptpad: "http://localhost:3000",
  jellyfin: "http://localhost:8096",
  authentik: "http://localhost:9000",
  postgres: "postgresql://localhost:5432",
};

export function getServiceUrl(service: string): string {
  const url = SERVICE_URLS[service];
  if (!url) {
    throw new Error(`Unknown service: ${service}`);
  }
  return url;
}
