/**
 * Rainbow App Builder — HTTP server for AI-powered app creation.
 *
 * Provides REST API for the dashboard to create, manage, and deploy
 * custom apps via Claude.
 */

fetch("/mcp", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    id: 2,
    params: { name: "email.list_mailboxes", arguments: {} },
  }),
})
  .then((r) => r.text())
  .then(console.log);

import express from "express";
import { Orchestrator } from "./builder/orchestrator.js";
import { AppRegistry } from "./registry/app-registry.js";
import { apiRoutes } from "./api/routes.js";

const PORT = parseInt(process.env.APP_BUILDER_PORT || "3002", 10);

const app = express();
app.use(express.json({ limit: "10mb" }));

const registry = new AppRegistry();
const orchestrator = new Orchestrator(registry);

// Mount API routes
app.use("/api/apps", apiRoutes(orchestrator, registry));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "app-builder" });
});

app.listen(PORT, () => {
  console.log(`App Builder listening on port ${PORT}`);
});
