/**
 * Files tools — Seafile REST API. Disabled at boot if SEAFILE_API_TOKEN
 * isn't set (e.g. setup.sh hasn't completed yet).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListLibraries } from "./libraries.js";
import { registerListFiles } from "./list.js";
import { registerSearchFiles } from "./search.js";
import { registerShareFile } from "./share.js";
import {
    registerReadFile,
    registerWriteFile,
    registerUploadFile,
    registerRecentFiles,
} from "./content.js";

export function registerFileTools(server: McpServer): void {
    if (!process.env.SEAFILE_API_TOKEN) {
        console.warn("[mcp/files] SEAFILE_API_TOKEN not set — file tools disabled");
        return;
    }
    registerListLibraries(server);
    registerListFiles(server);
    registerSearchFiles(server);
    registerShareFile(server);
    registerReadFile(server);
    registerWriteFile(server);
    registerUploadFile(server);
    registerRecentFiles(server);
}
