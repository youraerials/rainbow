/**
 * Rainbow MCP Docs Server
 *
 * Wraps CryptPad's API for document management operations
 * including creation, listing, and sharing of pads.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCreateDocument } from "./tools/create-document.js";
import { registerListDocuments } from "./tools/list-documents.js";
import { registerShareDocument } from "./tools/share-document.js";
import { registerDocumentsResource } from "./resources/documents.js";

const server = new McpServer({
  name: "rainbow-docs",
  version: "0.1.0",
});

// Register tools
registerCreateDocument(server);
registerListDocuments(server);
registerShareDocument(server);

// Register resources
registerDocumentsResource(server);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rainbow MCP Docs server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
