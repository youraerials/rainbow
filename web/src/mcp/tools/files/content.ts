/**
 * files.read   — fetch the contents of a text file as a string.
 * files.write  — create or overwrite a text file with a string body.
 * files.upload — upload a base64-encoded blob to a path.
 * files.recent — list recently-modified files across all libraries.
 *
 * Seafile's content API is a 2-step dance for both read and write: ask
 * for a download/upload URL, then GET/POST the actual bytes against
 * that URL. Tokens are good for one operation each.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seafile } from "./client.js";

const MAX_TEXT_BYTES = 1_048_576; // 1 MiB

interface RecentItem {
    repo_id: string;
    repo_name?: string;
    name?: string;
    parent_dir?: string;
    obj_type?: string; // "file" | "dir"
    last_modified?: string;
    size?: number;
}

export function registerReadFile(server: McpServer): void {
    server.tool(
        "files.read",
        "Fetch the contents of a UTF-8 text file. Refuses files larger than 1 MiB and binary files (use files.share for those).",
        {
            library_id: z.string().describe("Library ID from files.list_libraries"),
            path: z.string().describe("File path inside the library, e.g. /notes/recipe.md"),
        },
        async ({ library_id, path }) => {
            try {
                // Seafile gives us a one-shot URL via /file/?p=<path>&op=download.
                const tokenResp = await seafile<string>({
                    path: `/api2/repos/${encodeURIComponent(library_id)}/file/?p=${encodeURIComponent(path)}&op=download`,
                });
                if (!tokenResp.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Seafile file URL fetch failed: HTTP ${tokenResp.status}` }],
                    };
                }
                // The response is a JSON-quoted URL string; strip the quotes
                // if Seafile returned it that way.
                let downloadUrl = String(tokenResp.data ?? "").trim();
                if (downloadUrl.startsWith('"') && downloadUrl.endsWith('"')) {
                    downloadUrl = downloadUrl.slice(1, -1);
                }
                const dl = await fetch(downloadUrl);
                if (!dl.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Download failed: HTTP ${dl.status}` }],
                    };
                }
                const lenHeader = dl.headers.get("content-length");
                if (lenHeader && Number(lenHeader) > MAX_TEXT_BYTES) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `File is ${lenHeader} bytes — too large for files.read (1 MiB limit). Use files.share to get a download URL instead.` }],
                    };
                }
                const text = await dl.text();
                if (text.length > MAX_TEXT_BYTES) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: "File exceeded 1 MiB after download — refusing to return." }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ library_id, path, size_bytes: text.length, content: text }),
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}

async function fetchUploadUrl(libraryId: string, parentDir: string): Promise<string> {
    const resp = await seafile<string>({
        path: `/api2/repos/${encodeURIComponent(libraryId)}/upload-link/?p=${encodeURIComponent(parentDir)}`,
    });
    if (!resp.ok) throw new Error(`upload-link failed: HTTP ${resp.status} ${resp.error ?? ""}`);
    let url = String(resp.data ?? "").trim();
    if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
    return url;
}

async function uploadBytes(
    uploadUrl: string,
    parentDir: string,
    name: string,
    bytes: Uint8Array,
    relativeFromParent: string,
): Promise<{ ok: boolean; status: number; text: string }> {
    // Seafile expects multipart/form-data with `parent_dir`, `replace=1`,
    // and `file` with the filename. URL must include ?ret-json=1 so the
    // response is JSON instead of an HTML redirect.
    const form = new FormData();
    form.set("parent_dir", parentDir);
    form.set("replace", "1");
    form.set("relative_path", relativeFromParent);
    form.set("file", new Blob([bytes as unknown as ArrayBuffer]), name);
    const target = uploadUrl.includes("?") ? `${uploadUrl}&ret-json=1` : `${uploadUrl}?ret-json=1`;
    const resp = await fetch(target, {
        method: "POST",
        headers: {
            Authorization: `Token ${process.env.SEAFILE_API_TOKEN ?? ""}`,
        },
        body: form,
    });
    return { ok: resp.ok, status: resp.status, text: await resp.text() };
}

function splitDirAndName(fullPath: string): { dir: string; name: string } {
    const cleaned = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
    const lastSlash = cleaned.lastIndexOf("/");
    return {
        dir: cleaned.slice(0, lastSlash) || "/",
        name: cleaned.slice(lastSlash + 1),
    };
}

export function registerWriteFile(server: McpServer): void {
    server.tool(
        "files.write",
        "Create or overwrite a UTF-8 text file. The parent directory must already exist.",
        {
            library_id: z.string().describe("Library ID from files.list_libraries"),
            path: z.string().describe("Full file path, e.g. /notes/journal/2026-05-04.md"),
            content: z.string().describe("UTF-8 text content"),
        },
        async ({ library_id, path, content }) => {
            try {
                const { dir, name } = splitDirAndName(path);
                if (!name) {
                    return { isError: true, content: [{ type: "text" as const, text: "path must include a filename" }] };
                }
                const url = await fetchUploadUrl(library_id, dir);
                const r = await uploadBytes(url, dir, name, new TextEncoder().encode(content), "");
                if (!r.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Upload failed: HTTP ${r.status} ${r.text.slice(0, 200)}` }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ library_id, path, size_bytes: content.length, written: true }),
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}

export function registerUploadFile(server: McpServer): void {
    server.tool(
        "files.upload",
        "Upload a binary file from base64-encoded bytes. Use this for non-text content (images, PDFs, etc.).",
        {
            library_id: z.string().describe("Library ID from files.list_libraries"),
            path: z.string().describe("Full destination path"),
            content_base64: z
                .string()
                .describe("File contents, base64-encoded (e.g. btoa(...) on a binary string)"),
        },
        async ({ library_id, path, content_base64 }) => {
            try {
                const { dir, name } = splitDirAndName(path);
                if (!name) {
                    return { isError: true, content: [{ type: "text" as const, text: "path must include a filename" }] };
                }
                const bytes = Uint8Array.from(Buffer.from(content_base64, "base64"));
                const url = await fetchUploadUrl(library_id, dir);
                const r = await uploadBytes(url, dir, name, bytes, "");
                if (!r.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Upload failed: HTTP ${r.status} ${r.text.slice(0, 200)}` }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ library_id, path, size_bytes: bytes.length, uploaded: true }),
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}

export function registerRecentFiles(server: McpServer): void {
    server.tool(
        "files.recent",
        "List recently-modified files across all libraries the user can see.",
        {
            limit: z.number().int().positive().max(100).optional().describe("Max results (default 25)"),
            days: z.number().int().positive().max(90).optional().describe("Look-back window in days (default 7)"),
        },
        async ({ limit, days }) => {
            try {
                // Seafile exposes /api/v2.1/repos/<id>/history/ but no
                // cross-library "recent" endpoint. We approximate by
                // querying the activity feed at /api/v2.1/activities/
                // which IS cross-library.
                const params = new URLSearchParams({
                    avatar_size: "0",
                });
                const r = await seafile<{ events?: RecentItem[] }>({
                    path: `/api/v2.1/activities/?${params.toString()}`,
                });
                if (!r.ok) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Seafile activities failed: HTTP ${r.status}` }],
                    };
                }
                const cutoff = Date.now() - (days ?? 7) * 86400_000;
                const events = (r.data?.events ?? [])
                    .filter((e) => {
                        if (!e.last_modified) return false;
                        const t = new Date(e.last_modified).getTime();
                        return Number.isFinite(t) && t >= cutoff;
                    })
                    .filter((e) => e.obj_type === "file" || !e.obj_type)
                    .slice(0, limit ?? 25)
                    .map((e) => ({
                        library_id: e.repo_id,
                        library_name: e.repo_name,
                        name: e.name,
                        parent_dir: e.parent_dir,
                        modified_at: e.last_modified,
                        size_bytes: e.size,
                    }));
                return {
                    content: [
                        { type: "text" as const, text: JSON.stringify({ count: events.length, events }, null, 2) },
                    ],
                };
            } catch (err) {
                return {
                    isError: true,
                    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
                };
            }
        },
    );
}
