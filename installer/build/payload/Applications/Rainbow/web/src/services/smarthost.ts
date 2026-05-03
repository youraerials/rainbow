/**
 * SMTP smarthost relay — the "supported" outbound mail path.
 *
 * Direct outbound from a residential Mac Mini doesn't work reliably (most
 * ISPs penalize the IP, big providers quarantine). The realistic answer is
 * BYO smarthost: the user signs up with Resend / Postmark / Mailgun /
 * Amazon SES / generic SMTP, drops their credentials in the dashboard, and
 * Rainbow relays through that. The smarthost handles DKIM signing and IP
 * reputation; we just publish the DNS records they ask for.
 *
 * This module owns:
 *   - the config shape + persistence (one row in web_config keyed
 *     "smarthost.config")
 *   - send(): a thin wrapper around nodemailer
 *
 * Nothing else (admin API, MCP tool) reaches into nodemailer directly.
 */

import nodemailer, { Transporter } from "nodemailer";
import {
    getConfigValue,
    setConfigValue,
    deleteConfigValue,
} from "../db/config.js";

const CONFIG_KEY = "smarthost.config";

export type SmarthostProvider =
    | "resend"
    | "postmark"
    | "ses"
    | "mailgun"
    | "smtp";

export type SmarthostSecurity = "tls" | "starttls" | "none";

export interface SmarthostConfig {
    provider: SmarthostProvider;
    host: string;
    port: number;
    security: SmarthostSecurity;
    username: string;
    password: string;
    fromAddress: string;
    fromName?: string;
}

export interface SmarthostStatus {
    configured: boolean;
    provider?: SmarthostProvider;
    host?: string;
    port?: number;
    security?: SmarthostSecurity;
    username?: string;
    fromAddress?: string;
    fromName?: string;
    // Last 4 chars of password — enough for the user to recognize "yes I
    // saved this", never enough to use.
    passwordHint?: string;
}

export async function getConfig(): Promise<SmarthostConfig | null> {
    return getConfigValue<SmarthostConfig>(CONFIG_KEY);
}

export async function getStatus(): Promise<SmarthostStatus> {
    const cfg = await getConfig();
    if (!cfg) return { configured: false };
    return {
        configured: true,
        provider: cfg.provider,
        host: cfg.host,
        port: cfg.port,
        security: cfg.security,
        username: cfg.username,
        fromAddress: cfg.fromAddress,
        fromName: cfg.fromName,
        passwordHint: cfg.password.slice(-4),
    };
}

export async function saveConfig(cfg: SmarthostConfig): Promise<void> {
    validate(cfg);
    await setConfigValue(CONFIG_KEY, cfg);
}

export async function clearConfig(): Promise<void> {
    await deleteConfigValue(CONFIG_KEY);
}

function validate(cfg: SmarthostConfig): void {
    if (!cfg.host) throw new Error("host is required");
    if (!cfg.port || cfg.port < 1 || cfg.port > 65535) {
        throw new Error("port must be 1–65535");
    }
    if (!["tls", "starttls", "none"].includes(cfg.security)) {
        throw new Error("security must be tls, starttls, or none");
    }
    if (!cfg.username) throw new Error("username is required");
    if (!cfg.password) throw new Error("password is required");
    if (!cfg.fromAddress.includes("@")) {
        throw new Error("fromAddress must be a valid email");
    }
}

function buildTransporter(cfg: SmarthostConfig): Transporter {
    return nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.security === "tls", // implicit TLS
        requireTLS: cfg.security === "starttls",
        auth: { user: cfg.username, pass: cfg.password },
        // Trust modern providers' certs but tolerate self-issued ones in
        // odd setups. Reasonable middle ground for a self-hosted tool.
        tls: { rejectUnauthorized: cfg.security !== "none" },
    });
}

export interface SendInput {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    overrideFrom?: string; // rarely useful — most smarthosts forbid it
}

export interface SendResult {
    ok: boolean;
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    response?: string;
    error?: string;
}

export async function send(
    cfg: SmarthostConfig,
    input: SendInput,
): Promise<SendResult> {
    const transporter = buildTransporter(cfg);
    const from = input.overrideFrom
        ? input.overrideFrom
        : cfg.fromName
            ? `"${cfg.fromName}" <${cfg.fromAddress}>`
            : cfg.fromAddress;
    try {
        const info = await transporter.sendMail({
            from,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            replyTo: input.replyTo,
            subject: input.subject,
            text: input.text,
            html: input.html,
        });
        return {
            ok: true,
            messageId: info.messageId,
            accepted: info.accepted as string[] | undefined,
            rejected: info.rejected as string[] | undefined,
            response: info.response,
        };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        transporter.close();
    }
}

// Convenience: load config and send in one shot. Throws if not configured.
export async function sendUsingSavedConfig(input: SendInput): Promise<SendResult> {
    const cfg = await getConfig();
    if (!cfg) {
        return { ok: false, error: "no smarthost configured" };
    }
    return send(cfg, input);
}
