/**
 * Idempotent bootstrap migrations. Runs on every web tier startup so existing
 * postgres deployments (predating Phase 6) pick up the new schema without
 * needing to wipe and re-init.
 *
 * Order:
 *   1. Ensure database `rainbow_web` exists (connect to system db `postgres`).
 *   2. Ensure role `rainbow_apps` exists (forward-looking; not yet used).
 *   3. CREATE TABLE IF NOT EXISTS for web_config, apps, apps_data.
 *   4. GRANT permissions to rainbow_apps on apps_data only.
 */

import pg from "pg";
import { getPool, getBootstrapPool, isConfigured } from "./pool.js";

async function ensureDatabase(): Promise<void> {
    const bootstrap = getBootstrapPool();
    if (!bootstrap) return;
    try {
        const result = await bootstrap.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            ["rainbow_web"],
        );
        if (result.rowCount === 0) {
            console.log("[db] creating database rainbow_web");
            // CREATE DATABASE can't be parameterized.
            await bootstrap.query("CREATE DATABASE rainbow_web");
        }
    } finally {
        await bootstrap.end();
    }
}

async function ensureRole(client: pg.PoolClient): Promise<void> {
    // rainbow_apps role is a placeholder for future direct-from-app DB
    // access. We create it with no password (LOGIN GRANTED; password set
    // separately if/when needed) so the GRANT below has something to bind to.
    await client.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rainbow_apps') THEN
                CREATE ROLE rainbow_apps WITH LOGIN NOINHERIT;
            END IF;
        END
        $$;
    `);
}

async function ensureTables(client: pg.PoolClient): Promise<void> {
    // web_config: small key/value store for web tier settings (e.g. the
    // user-supplied Anthropic API key). value is jsonb so we can store
    // structured config later (rate limits, default models, etc.).
    await client.query(`
        CREATE TABLE IF NOT EXISTS web_config (
            key         text PRIMARY KEY,
            value       jsonb NOT NULL,
            updated_at  timestamptz NOT NULL DEFAULT now()
        );
    `);

    // apps: metadata for every user-generated app installed in this Rainbow.
    await client.query(`
        CREATE TABLE IF NOT EXISTS apps (
            slug          text PRIMARY KEY,
            name          text NOT NULL,
            description   text,
            prompt        text,
            generated_at  timestamptz NOT NULL DEFAULT now(),
            generated_by  text,
            model         text
        );
    `);

    // apps_data: shared key/value persistence for all generated apps.
    // Each app sees only its own rows (enforced at the API layer; the
    // rainbow_apps DB role gets row-level granularity later if we expose
    // direct DB access).
    await client.query(`
        CREATE TABLE IF NOT EXISTS apps_data (
            app_slug     text NOT NULL,
            key          text NOT NULL,
            value        jsonb NOT NULL,
            updated_at   timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (app_slug, key),
            FOREIGN KEY (app_slug) REFERENCES apps(slug) ON DELETE CASCADE
        );
    `);
}

async function ensureGrants(client: pg.PoolClient): Promise<void> {
    // Rainbow_apps gets read/write on apps_data only. web_config and apps
    // (metadata) stay locked to the rainbow superuser.
    await client.query(`
        GRANT CONNECT ON DATABASE rainbow_web TO rainbow_apps;
        GRANT USAGE ON SCHEMA public TO rainbow_apps;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE apps_data TO rainbow_apps;
    `);
}

export async function migrate(): Promise<void> {
    if (!isConfigured()) {
        console.warn("[db] postgres not configured — skipping migrations");
        return;
    }
    await ensureDatabase();
    const pool = getPool();
    if (!pool) return;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await ensureRole(client);
        await ensureTables(client);
        await ensureGrants(client);
        await client.query("COMMIT");
        console.log("[db] migrations OK");
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}
