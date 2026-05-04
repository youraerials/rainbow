/**
 * System tools — health checks and service introspection for the Rainbow stack.
 *
 * Tools that need shell access (backup runs, container start/stop, etc.) are
 * intentionally left out: the web container can't reach those without a host
 * agent. They'll be exposed via a separate control-plane channel later.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHealthCheck } from "./health.js";
import { registerListServices } from "./services.js";
import { registerMe } from "./me.js";

export function registerSystemTools(server: McpServer): void {
    registerHealthCheck(server);
    registerListServices(server);
    registerMe(server);
}
