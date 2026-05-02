/**
 * Postgres connection pool. Web tier uses the rainbow superuser to read/write
 * its own database (rainbow_web). The shared postgres instance is reachable
 * over the backend network — the orchestrator passes its IP via env.
 *
 * Connection params:
 *   POSTGRES_HOST       — IP injected by orchestrator at start_web time
 *   POSTGRES_PORT       — defaults to 5432
 *   POSTGRES_USER       — rainbow (superuser)
 *   POSTGRES_PASSWORD   — same as elsewhere in the stack
 *   POSTGRES_WEB_DB     — defaults to rainbow_web
 */

import pg from "pg";

const HOST = process.env.POSTGRES_HOST ?? "";
const PORT = Number(process.env.POSTGRES_PORT ?? "5432");
const USER = process.env.POSTGRES_USER ?? "rainbow";
const PASSWORD = process.env.POSTGRES_PASSWORD ?? "";
const DB = process.env.POSTGRES_WEB_DB ?? "rainbow_web";

let pool: pg.Pool | null = null;

export function isConfigured(): boolean {
    return HOST !== "" && PASSWORD !== "";
}

/**
 * Lazy-initialized pool. Connects to the rainbow_web database directly.
 * Returns null if env isn't populated (e.g. orchestrator hasn't passed
 * postgres credentials yet) — callers should handle that gracefully.
 */
export function getPool(): pg.Pool | null {
    if (!isConfigured()) return null;
    if (!pool) {
        pool = new pg.Pool({
            host: HOST,
            port: PORT,
            user: USER,
            password: PASSWORD,
            database: DB,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
        pool.on("error", (err) => {
            console.error("[db] idle pool error:", err);
        });
    }
    return pool;
}

/**
 * Connection pool to the bootstrap database (`postgres` system db) — used
 * only at startup to CREATE DATABASE rainbow_web if it doesn't already exist.
 */
export function getBootstrapPool(): pg.Pool | null {
    if (!isConfigured()) return null;
    return new pg.Pool({
        host: HOST,
        port: PORT,
        user: USER,
        password: PASSWORD,
        database: "postgres",
        max: 1,
        connectionTimeoutMillis: 5_000,
    });
}
