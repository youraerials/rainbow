/**
 * Rainbow MCP Media Server
 *
 * Wraps the Jellyfin REST API for media server management.
 * Provides tools for searching, library management, and playback control.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerSearchMedia } from "./tools/search-media.js";
import { registerManageLibrary } from "./tools/manage-library.js";
import { registerPlaybackControl } from "./tools/playback-control.js";
import { registerLibrariesResource } from "./resources/libraries.js";

const server = new McpServer({
  name: "rainbow-media",
  version: "0.1.0",
});

// ─── Tools ─────────────────────────────────────────────────────
registerSearchMedia(server);
registerManageLibrary(server);
registerPlaybackControl(server);

// ─── Resources ─────────────────────────────────────────────────
registerLibrariesResource(server);

// ─── Start server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Media server started (Jellyfin)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
