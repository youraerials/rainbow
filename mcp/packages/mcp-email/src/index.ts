/**
 * Rainbow MCP Email Server
 *
 * Wraps Stalwart mail server's JMAP API for email operations
 * and CalDAV/CardDAV for calendar and contacts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerSendEmail } from "./tools/send-email.js";
import { registerSearchEmail } from "./tools/search-email.js";
import { registerCalendarTools } from "./tools/manage-calendar.js";
import { registerContactTools } from "./tools/manage-contacts.js";
import { registerInboxResource } from "./resources/inbox.js";
import { registerCalendarResource } from "./resources/calendar.js";

const server = new McpServer({
  name: "rainbow-email",
  version: "0.1.0",
});

// ─── Register tools ────────────────────────────────────────────

registerSendEmail(server);
registerSearchEmail(server);
registerCalendarTools(server);
registerContactTools(server);

// ─── Register resources ────────────────────────────────────────

registerInboxResource(server);
registerCalendarResource(server);

// ─── Start server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Email server started (Stalwart JMAP/CalDAV)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
