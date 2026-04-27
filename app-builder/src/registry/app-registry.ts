/**
 * AppRegistry — Tracks deployed custom apps.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface AppEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  status: "running" | "stopped" | "building";
  created_at: string;
  updated_at: string;
  files?: Array<{ path: string; content: string }>;
}

interface CreateOptions {
  name: string;
  description: string;
  files: Array<{ path: string; content: string }>;
}

const REGISTRY_DIR = process.env.REGISTRY_DIR || join(process.cwd(), "apps");
const REGISTRY_FILE = join(REGISTRY_DIR, "registry.json");

export class AppRegistry {
  private apps: Map<string, AppEntry> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    if (existsSync(REGISTRY_FILE)) {
      try {
        const data = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
        for (const app of data.apps || []) {
          this.apps.set(app.id, app);
        }
      } catch {
        // Start fresh if file is corrupted
      }
    }
  }

  private save(): void {
    mkdirSync(REGISTRY_DIR, { recursive: true });
    const data = { apps: Array.from(this.apps.values()) };
    writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  create(options: CreateOptions): AppEntry {
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    const app: AppEntry = {
      id,
      name: options.name,
      description: options.description,
      url: "",
      status: "building",
      created_at: now,
      updated_at: now,
      files: options.files,
    };

    this.apps.set(id, app);
    this.save();
    return app;
  }

  get(id: string): AppEntry | null {
    return this.apps.get(id) || null;
  }

  update(id: string, updates: Partial<AppEntry>): AppEntry {
    const existing = this.apps.get(id);
    if (!existing) throw new Error(`App not found: ${id}`);

    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.apps.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): void {
    this.apps.delete(id);
    this.save();
  }

  list(): AppEntry[] {
    return Array.from(this.apps.values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
