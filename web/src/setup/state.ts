/**
 * Setup-mode state persistence.
 *
 * The wizard's progress lives in a single JSON file at
 * `~/Library/Application Support/Rainbow/setup-state.json` (the path
 * inside the container is bind-mounted by the .pkg installer's
 * postinstall script). Persisting to disk means a closed browser tab
 * or container restart doesn't lose progress — the wizard reads state
 * on load and resumes from `step`.
 *
 * Secrets (API keys, tunnel credentials, HMAC) are NOT stored here.
 * They flow through the wizard at provision time and get written
 * directly to their final homes (Keychain via the host control daemon,
 * `~/.cloudflared/<id>.json`, etc.).
 */

import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH =
    process.env.RAINBOW_SETUP_STATE_PATH ??
    "/var/lib/rainbow/setup/setup-state.json";

export type DomainMode = "claim" | "byo";

export interface SetupState {
    /** 0-indexed wizard step the user last completed. */
    step: number;
    preflight?: {
        passedAt: string;
        macosVersion?: string;
        appleSilicon?: boolean;
        controlDaemonUp?: boolean;
    };
    domain?: {
        mode: DomainMode;
        /** "aubrey" for claim path; empty for BYO. */
        prefix?: string;
        /** "rainbow.rocks" for claim; the user's zone for BYO. */
        zone: string;
        /** Full apex hostname: "aubrey.rainbow.rocks" or "example.com". */
        apex: string;
    };
    tunnel?: {
        id: string;
        name: string;
        credentialsWrittenTo: string;
    };
    admin?: {
        email: string;
        name: string;
        // Held only between the AdminStep submission and mint-secrets;
        // provision.ts strips it from state once the password is in
        // Keychain so it doesn't sit in plaintext on disk.
        password?: string;
    };
    services?: Record<string, boolean>;
    storage?: Record<string, string>;
    /** Set when /api/setup/finalize completes and the orchestrator has come up. */
    completedAt?: string;
}

const initial: SetupState = { step: 0 };

export async function readState(): Promise<SetupState> {
    try {
        const raw = await fs.readFile(STATE_PATH, "utf8");
        return JSON.parse(raw) as SetupState;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return { ...initial };
        }
        console.error("[setup/state] read failed:", err);
        return { ...initial };
    }
}

export async function writeState(state: SetupState): Promise<void> {
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    // Write to a temp file then rename for atomicity — avoids leaving the
    // wizard with a half-written state file if the container is killed
    // mid-write.
    const tmp = `${STATE_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, STATE_PATH);
}

export async function patchState(
    patch: Partial<SetupState>,
): Promise<SetupState> {
    const current = await readState();
    const next = { ...current, ...patch };
    await writeState(next);
    return next;
}
