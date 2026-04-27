/**
 * Rainbow MCP Gateway
 *
 * Aggregates all Rainbow MCP servers into a single Streamable HTTP endpoint.
 * Clients connect to this gateway and get access to tools/resources from
 * all enabled services.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "@rainbow/mcp-common";

const config = loadConfig();

const server = new McpServer({
  name: "rainbow-gateway",
  version: config.rainbow.version,
});

// ─── System tools (always available) ────────────────────────────

server.tool("system_status", "Get the status of all Rainbow services", {}, async () => {
  // TODO: Implement actual health checks
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            domain: config.domain.primary,
            services: Object.entries(config.services)
              .filter(([_, svc]) => svc.enabled !== false)
              .map(([name]) => ({ name, status: "unknown" })),
          },
          null,
          2
        ),
      },
    ],
  };
});

server.tool(
  "service_list",
  "List all configured Rainbow services and their URLs",
  {},
  async () => {
    const domain = config.domain.primary;
    const services = [
      { name: "Dashboard", url: `https://app.${domain}` },
      { name: "Photos (Immich)", url: `https://photos.${domain}` },
      { name: "Email (Stalwart)", url: `https://mail.${domain}` },
      { name: "Files (Seafile)", url: `https://files.${domain}` },
      { name: "Docs (CryptPad)", url: `https://docs.${domain}` },
      { name: "Media (Jellyfin)", url: `https://media.${domain}` },
      { name: "Auth (Authentik)", url: `https://auth.${domain}` },
    ];

    return {
      content: [{ type: "text", text: JSON.stringify(services, null, 2) }],
    };
  }
);

// ─── Start server ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Rainbow MCP Gateway started (${config.domain.primary})`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
