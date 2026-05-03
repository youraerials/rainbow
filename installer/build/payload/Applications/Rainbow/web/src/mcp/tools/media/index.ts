/**
 * Media tools — Jellyfin REST API. Disabled at boot if JELLYFIN_API_KEY
 * isn't set (services/jellyfin/setup.sh provisions it after first-run wizard).
 *
 * Deferred for Phase 3: playback-control. Most users will use the Jellyfin
 * native apps for playback rather than driving it via MCP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchMedia } from "./search.js";
import { registerListLibraries } from "./libraries.js";
import { registerRecent } from "./recent.js";

export function registerMediaTools(server: McpServer): void {
    if (!process.env.JELLYFIN_API_KEY) {
        console.warn("[mcp/media] JELLYFIN_API_KEY not set — media tools disabled");
        return;
    }
    registerSearchMedia(server);
    registerListLibraries(server);
    registerRecent(server);
}
