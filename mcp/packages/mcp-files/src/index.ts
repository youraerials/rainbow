/**
 * Rainbow MCP Files Server
 *
 * Wraps Seafile's REST API for file management operations —
 * listing, uploading, downloading, sharing, and searching files.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerListFiles } from "./tools/list-files.js";
import { registerUploadFile } from "./tools/upload-file.js";
import { registerDownloadFile } from "./tools/download-file.js";
import { registerShareFile } from "./tools/share-file.js";
import { registerSearchFiles } from "./tools/search-files.js";
import { registerLibrariesResource } from "./resources/libraries.js";

const server = new McpServer({
  name: "rainbow-files",
  version: "0.1.0",
});

// ─── Register tools ────────────────────────────────────────────

registerListFiles(server);
registerUploadFile(server);
registerDownloadFile(server);
registerShareFile(server);
registerSearchFiles(server);

// ─── Register resources ────────────────────────────────────────

registerLibrariesResource(server);

// ─── Start server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Files server started (Seafile REST API)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
