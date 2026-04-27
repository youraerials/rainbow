/**
 * Rainbow MCP Photos Server
 *
 * Wraps the Immich REST API for photo and video management.
 * Provides tools for searching, uploading, album management, and sharing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerSearchPhotos } from "./tools/search-photos.js";
import { registerCreateAlbum } from "./tools/create-album.js";
import { registerUploadPhoto } from "./tools/upload-photo.js";
import { registerShareAlbum } from "./tools/share-album.js";
import { registerAlbumsResource } from "./resources/albums.js";
import { registerRecentResource } from "./resources/recent.js";

const server = new McpServer({
  name: "rainbow-photos",
  version: "0.1.0",
});

// ─── Tools ─────────────────────────────────────────────────────
registerSearchPhotos(server);
registerCreateAlbum(server);
registerUploadPhoto(server);
registerShareAlbum(server);

// ─── Resources ─────────────────────────────────────────────────
registerAlbumsResource(server);
registerRecentResource(server);

// ─── Start server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Photos server started (Immich)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
