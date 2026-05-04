/**
 * App metadata + per-app key/value persistence.
 */

import { getPool } from "./pool.js";

export interface AppMetadata {
    slug: string;
    name: string;
    description: string | null;
    prompt: string | null;
    generatedAt: string;
    generatedBy: string | null;
    model: string | null;
    isHome: boolean;
}

interface AppRow {
    slug: string;
    name: string;
    description: string | null;
    prompt: string | null;
    generated_at: Date;
    generated_by: string | null;
    model: string | null;
    is_home: boolean;
}

function fromRow(r: AppRow): AppMetadata {
    return {
        slug: r.slug,
        name: r.name,
        description: r.description,
        prompt: r.prompt,
        generatedAt: r.generated_at.toISOString(),
        generatedBy: r.generated_by,
        model: r.model,
        isHome: r.is_home,
    };
}

export async function listApps(): Promise<AppMetadata[]> {
    const pool = getPool();
    if (!pool) return [];
    const result = await pool.query<AppRow>(
        "SELECT * FROM apps ORDER BY generated_at DESC",
    );
    return result.rows.map(fromRow);
}

export async function getApp(slug: string): Promise<AppMetadata | null> {
    const pool = getPool();
    if (!pool) return null;
    const result = await pool.query<AppRow>(
        "SELECT * FROM apps WHERE slug = $1",
        [slug],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export interface CreateAppInput {
    slug: string;
    name: string;
    description?: string;
    prompt?: string;
    generatedBy?: string;
    model?: string;
}

export async function createApp(input: CreateAppInput): Promise<AppMetadata> {
    const pool = getPool();
    if (!pool) throw new Error("postgres not configured");
    const result = await pool.query<AppRow>(
        `INSERT INTO apps (slug, name, description, prompt, generated_by, model)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
            input.slug,
            input.name,
            input.description ?? null,
            input.prompt ?? null,
            input.generatedBy ?? null,
            input.model ?? null,
        ],
    );
    return fromRow(result.rows[0]);
}

export async function deleteApp(slug: string): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;
    const result = await pool.query("DELETE FROM apps WHERE slug = $1", [slug]);
    return (result.rowCount ?? 0) > 0;
}

/**
 * Mark `slug` as the user's home app. Atomically clears any prior home
 * (the partial unique index `apps_one_home_idx` would otherwise reject
 * the second SET). Returns true if the app exists and is now home.
 */
export async function setHomeApp(slug: string): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("UPDATE apps SET is_home = false WHERE is_home = true");
        const result = await client.query(
            "UPDATE apps SET is_home = true WHERE slug = $1",
            [slug],
        );
        await client.query("COMMIT");
        return (result.rowCount ?? 0) > 0;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

/** Clear the home flag on `slug`. */
export async function unsetHomeApp(slug: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
        "UPDATE apps SET is_home = false WHERE slug = $1",
        [slug],
    );
}

/** Returns the slug of the app currently flagged as home, or null. */
export async function getHomeAppSlug(): Promise<string | null> {
    const pool = getPool();
    if (!pool) return null;
    const result = await pool.query<{ slug: string }>(
        "SELECT slug FROM apps WHERE is_home = true LIMIT 1",
    );
    return result.rows[0]?.slug ?? null;
}

// ─── Per-app key/value persistence ───────────────────────────────

export async function getAllAppData(slug: string): Promise<Record<string, unknown>> {
    const pool = getPool();
    if (!pool) return {};
    const result = await pool.query<{ key: string; value: unknown }>(
        "SELECT key, value FROM apps_data WHERE app_slug = $1",
        [slug],
    );
    const out: Record<string, unknown> = {};
    for (const row of result.rows) out[row.key] = row.value;
    return out;
}

export async function getAppData(slug: string, key: string): Promise<unknown> {
    const pool = getPool();
    if (!pool) return null;
    const result = await pool.query<{ value: unknown }>(
        "SELECT value FROM apps_data WHERE app_slug = $1 AND key = $2",
        [slug, key],
    );
    return result.rows[0]?.value ?? null;
}

export async function setAppData(
    slug: string,
    key: string,
    value: unknown,
): Promise<void> {
    const pool = getPool();
    if (!pool) throw new Error("postgres not configured");
    await pool.query(
        `INSERT INTO apps_data (app_slug, key, value, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (app_slug, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [slug, key, JSON.stringify(value)],
    );
}

export async function deleteAppData(slug: string, key: string): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;
    const result = await pool.query(
        "DELETE FROM apps_data WHERE app_slug = $1 AND key = $2",
        [slug, key],
    );
    return (result.rowCount ?? 0) > 0;
}
