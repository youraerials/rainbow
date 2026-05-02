/**
 * Parse Claude's app-generation response into a list of files.
 *
 * Expected format (from prompt.ts):
 *   ```file:<path>
 *   <content>
 *   ```
 *
 * Tolerant of common slips:
 *  - Optional leading prose before the first file block (we ignore it).
 *  - Optional language hint after `file:path` (e.g. ```file:index.html`).
 *  - Final fence may or may not be followed by a newline.
 */

import { AppFile } from "./files.js";

const FILE_BLOCK = /```file:([^\s`]+)[^\n]*\n([\s\S]*?)```/g;

export function parseGeneratedFiles(response: string): AppFile[] {
    const files: AppFile[] = [];
    let match: RegExpExecArray | null;
    while ((match = FILE_BLOCK.exec(response)) !== null) {
        const [, rawPath, content] = match;
        const cleanPath = rawPath.trim().replace(/^\/+/, "");
        if (!cleanPath) continue;
        files.push({
            path: cleanPath,
            // Trailing newline before closing ``` is part of the format —
            // strip it so the saved file ends exactly where the author meant.
            content: content.replace(/\n$/, ""),
        });
    }
    return files;
}

export function hasIndexHtml(files: AppFile[]): boolean {
    return files.some((f) => f.path === "index.html");
}
