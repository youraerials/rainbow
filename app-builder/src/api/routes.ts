/**
 * REST API routes for the app builder.
 */

import { Router } from "express";
import type { Orchestrator } from "../builder/orchestrator.js";
import type { AppRegistry } from "../registry/app-registry.js";

export function apiRoutes(
  orchestrator: Orchestrator,
  registry: AppRegistry
): Router {
  const router = Router();

  // List all apps
  router.get("/", (_req, res) => {
    const apps = registry.list().map(({ files, ...app }) => app);
    res.json(apps);
  });

  // Get a specific app
  router.get("/:id", (req, res) => {
    const app = registry.get(req.params.id);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    const { files, ...safe } = app;
    res.json(safe);
  });

  // Build a new app or iterate on existing
  router.post("/build", async (req, res) => {
    const { message, history, app_id } = req.body;

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const result = await orchestrator.build({ message, history, app_id });

    const response: Record<string, unknown> = { message: result.message };
    if (result.app) {
      const { files, ...safe } = result.app;
      response.app = safe;
    }
    if (result.error) {
      response.error = result.error;
    }

    res.json(response);
  });

  // Delete an app
  router.delete("/:id", (req, res) => {
    const app = registry.get(req.params.id);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    registry.delete(req.params.id);
    res.json({ success: true, deleted: req.params.id });
  });

  return router;
}
