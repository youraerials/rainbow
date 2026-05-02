/**
 * Photos tools — wraps Immich's REST API. The orchestrator provides
 * IMMICH_API_KEY (provisioned by services/immich/setup.sh); without it,
 * registration is a no-op so the gateway still boots even if Immich's
 * setup hasn't completed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchPhotos } from "./search.js";
import { registerRecent } from "./recent.js";
import { registerListAlbums, registerCreateAlbum } from "./albums.js";
import { registerShareAlbum } from "./share.js";

export function registerPhotoTools(server: McpServer): void {
    if (!process.env.IMMICH_API_KEY) {
        console.warn("[mcp/photos] IMMICH_API_KEY not set — photo tools disabled");
        return;
    }
    registerSearchPhotos(server);
    registerRecent(server);
    registerListAlbums(server);
    registerCreateAlbum(server);
    registerShareAlbum(server);
    // upload_photo intentionally deferred: needs multipart/form-data handling
    // and a file source on the server side, which we'd have to design (probably
    // via a /api/upload endpoint that the SPA or generated apps use).
}
