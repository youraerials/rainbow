/**
 * Rainbow MCP System Server
 *
 * System-level operations for the Rainbow platform:
 * backups, health checks, DNS management, service control,
 * and user management via Authentik.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBackup } from "./tools/backup.js";
import { registerServiceControl } from "./tools/service-control.js";
import { registerHealthCheck } from "./tools/health-check.js";
import { registerDnsManagement } from "./tools/dns-management.js";
import { registerUserManagement } from "./tools/user-management.js";
import { registerSystemStatusResource } from "./resources/system-status.js";
import { registerServiceListResource } from "./resources/service-list.js";

const server = new McpServer({
  name: "rainbow-system",
  version: "0.1.0",
});

// Register tools
registerBackup(server);
registerServiceControl(server);
registerHealthCheck(server);
registerDnsManagement(server);
registerUserManagement(server);

// Register resources
registerSystemStatusResource(server);
registerServiceListResource(server);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP System server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
