/**
 * web_config: small key/value store for global web tier settings.
 * Right now only used for the user-supplied Anthropic API key, but the
 * shape generalizes (rate limits, default model, feature flags, etc.).
 */

import { getPool } from "./pool.js";

export async function getConfigValue<T = unknown>(key: string): Promise<T | null> {
    const pool = getPool();
    if (!pool) return null;
    const result = await pool.query<{ value: T }>(
        "SELECT value FROM web_config WHERE key = $1",
        [key],
    );
    return result.rows[0]?.value ?? null;
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
    const pool = getPool();
    if (!pool) throw new Error("postgres not configured");
    await pool.query(
        `INSERT INTO web_config (key, value, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
    );
}

export async function deleteConfigValue(key: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await pool.query("DELETE FROM web_config WHERE key = $1", [key]);
}
