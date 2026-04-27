/**
 * Rainbow MCP Minecraft Server
 *
 * Controls a Paper Minecraft server via the RCON protocol.
 * Provides tools for server control, player management,
 * world management, and raw RCON command passthrough.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerServerControl } from "./tools/server-control.js";
import { registerPlayerManagement } from "./tools/player-management.js";
import { registerWorldManagement } from "./tools/world-management.js";
import { registerRcon } from "./tools/rcon.js";
import { registerServerStatusResource } from "./resources/server-status.js";

const server = new McpServer({
  name: "rainbow-minecraft",
  version: "0.1.0",
});

// Register tools
registerServerControl(server);
registerPlayerManagement(server);
registerWorldManagement(server);
registerRcon(server);

// Register resources
registerServerStatusResource(server);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Minecraft server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
