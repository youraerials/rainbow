/**
 * Deployer — Builds and deploys custom apps as Docker containers.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppEntry } from "../registry/app-registry.js";

const APPS_DIR = process.env.APPS_DIR || join(process.cwd(), "apps");

interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

export class Deployer {
  /**
   * Deploy an app: write files, build Docker image, start container.
   */
  async deploy(app: AppEntry): Promise<DeployResult> {
    const appDir = join(APPS_DIR, app.id);

    try {
      // Write files to disk
      mkdirSync(appDir, { recursive: true });
      for (const file of app.files || []) {
        const filePath = join(appDir, file.path);
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        if (dir !== appDir) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, file.content, "utf-8");
      }

      // Build container image
      const imageName = `rainbow-app-${app.id}`;
      const containerName = `rainbow-app-${app.id}`;

      execSync(`container build -t ${imageName} .`, {
        cwd: appDir,
        stdio: "pipe",
        timeout: 120000,
      });

      // Stop existing container if running
      try {
        execSync(`container stop ${containerName} && container rm ${containerName}`, {
          stdio: "pipe",
        });
      } catch {
        // Container doesn't exist yet, that's fine
      }

      // Start container on the rainbow frontend network
      const port = this.allocatePort(app.id);
      execSync(
        `container run -d ` +
          `--name ${containerName} ` +
          `-p 127.0.0.1:${port}:8000 ` +
          `${imageName}`,
        { stdio: "pipe" }
      );

      // The URL will be the app's subdomain (configured in Caddy)
      const url = `http://localhost:${port}`;

      return { success: true, url };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Deploy failed";
      return { success: false, error: msg };
    }
  }

  /** Allocate a port for the app based on its ID hash. */
  private allocatePort(appId: string): number {
    // Simple hash to port mapping in range 4000-5000
    let hash = 0;
    for (const char of appId) {
      hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
    }
    return 4000 + (hash % 1000);
  }
}
