/**
 * Photos tools — wraps Immich's REST API. The orchestrator provides
 * IMMICH_API_KEY (provisioned by services/immich/setup.sh); without it,
 * registration is a no-op so the gateway still boots even if Immich's
 * setup hasn't completed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchPhotos } from "./search.js";

export function registerPhotoTools(server: McpServer): void {
    if (!process.env.IMMICH_API_KEY) {
        console.warn("[mcp/photos] IMMICH_API_KEY not set — photo tools disabled");
        return;
    }
    registerSearchPhotos(server);
    // create-album, share-album, upload-photo, recent, albums land here next.
}
