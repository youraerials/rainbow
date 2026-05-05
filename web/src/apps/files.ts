/**
 * Filesystem helpers for user-generated apps. Each app lives in a
 * directory under RAINBOW_APPS_DIR (mounted from
 * ~/Library/Application Support/Rainbow/web-apps on the host).
 *
 * App directories contain plain HTML/JS/CSS — no server-side execution
 * happens. The static files are served by Express at /apps/<slug>/.
 */

import path from "node:path";
import { mkdir, writeFile, rm, access, readFile, readdir, stat } from "node:fs/promises";

const APPS_DIR = process.env.RAINBOW_APPS_DIR ?? "/var/lib/rainbow/apps";

export function appsRoot(): string {
    return APPS_DIR;
}

export function appDir(slug: string): string {
    return path.join(APPS_DIR, slug);
}

/**
 * Slug-safety: only allow lowercase alphanumerics, dashes, underscores.
 * Apps are addressable at /apps/<slug>/* so we can't have characters that
 * would change URL semantics.
 */
export function isValidSlug(slug: string): boolean {
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export async function appExists(slug: string): Promise<boolean> {
    if (!isValidSlug(slug)) return false;
    try {
        await access(appDir(slug));
        return true;
    } catch {
        return false;
    }
}

export interface AppFile {
    /** Path relative to the app's root directory. e.g. "index.html", "js/main.js". */
    path: string;
    content: string;
}

export async function writeAppFiles(slug: string, files: AppFile[]): Promise<void> {
    if (!isValidSlug(slug)) throw new Error(`invalid slug: ${slug}`);
    const root = appDir(slug);
    await mkdir(root, { recursive: true });
    for (const f of files) {
        // Reject any file that would escape the app's directory.
        const target = path.resolve(root, f.path);
        if (!target.startsWith(root + path.sep) && target !== root) {
            throw new Error(`path escapes app dir: ${f.path}`);
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, f.content, "utf8");
    }
}

export async function removeAppFiles(slug: string): Promise<void> {
    if (!isValidSlug(slug)) return;
    await rm(appDir(slug), { recursive: true, force: true });
}

/**
 * Read every file in an app's directory, returning their relative paths
 * + UTF-8 contents. Used by the edit flow so Claude sees the current
 * source before generating a revision. Skips binary-looking files
 * (images, etc.) and anything over 256KB to keep the prompt bounded.
 */
const MAX_FILE_BYTES = 256 * 1024;
const SKIP_EXT = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".webm", ".mov", ".pdf", ".zip",
]);

export async function readAppFiles(slug: string): Promise<AppFile[]> {
    if (!isValidSlug(slug)) throw new Error(`invalid slug: ${slug}`);
    const root = appDir(slug);
    const out: AppFile[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
                continue;
            }
            if (!e.isFile()) continue;
            const ext = path.extname(e.name).toLowerCase();
            if (SKIP_EXT.has(ext)) continue;
            const st = await stat(full);
            if (st.size > MAX_FILE_BYTES) continue;
            const content = await readFile(full, "utf8");
            out.push({
                path: path.relative(root, full).replaceAll(path.sep, "/"),
                content,
            });
        }
    }
    await walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
}
