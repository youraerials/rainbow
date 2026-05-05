/**
 * Drives Claude through one app-edit request:
 *   1. Look up the app's metadata + read its current files from disk.
 *   2. Build an edit-mode system prompt that includes those files inline.
 *   3. Ask Claude with the user's instruction as the message.
 *   4. Parse the response; write the files Claude returned (leaving
 *      omitted files untouched).
 *
 * Same Anthropic key, same model, same parser as generate.ts — only
 * the prompt and the file write strategy differ.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getConfigValue } from "../db/config.js";
import { getApp } from "../db/apps.js";
import { listTools } from "../mcp/server.js";
import { buildEditSystemPrompt, APP_GENERATION_MODEL, MAX_TOKENS } from "./prompt.js";
import { parseGeneratedFiles } from "./parse.js";
import { isValidSlug, appExists, readAppFiles, writeAppFiles } from "./files.js";

const ANTHROPIC_KEY_CONFIG = "anthropic.api_key";

export interface EditInput {
    slug: string;
    instruction: string;
    webHost: string;
}

export interface EditResult {
    slug: string;
    changedFiles: { path: string; size: number }[];
    model: string;
    tokens: { input: number; output: number };
}

export async function editApp(input: EditInput): Promise<EditResult> {
    if (!isValidSlug(input.slug)) {
        throw new Error(`slug "${input.slug}" is invalid`);
    }
    if (!(await appExists(input.slug))) {
        throw new Error(`app "${input.slug}" not found`);
    }
    const instruction = input.instruction.trim();
    if (!instruction) {
        throw new Error("instruction is required");
    }

    const apiKey = await getConfigValue<string>(ANTHROPIC_KEY_CONFIG);
    if (typeof apiKey !== "string" || !apiKey) {
        throw new Error(
            "no Anthropic API key configured. PUT /api/admin/anthropic-key first.",
        );
    }

    const meta = await getApp(input.slug);
    const currentFiles = await readAppFiles(input.slug);
    const tools = listTools();
    const systemPrompt = buildEditSystemPrompt({
        slug: input.slug,
        availableTools: tools,
        webHost: input.webHost,
        currentFiles,
        originalPrompt: meta?.prompt ?? null,
    });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
        model: APP_GENERATION_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
            { role: "user", content: instruction },
        ],
    });

    const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n");

    const files = parseGeneratedFiles(text);
    if (files.length === 0) {
        throw new Error(
            `Claude's response did not include any file blocks. Got:\n\n--- response start ---\n${text.slice(0, 500)}\n--- response truncated ---`,
        );
    }

    // Partial write: only the files Claude returned. Existing files
    // not mentioned stay on disk — that's how we keep the app whole
    // when the instruction targets a single file ("fix scroll in
    // index.html" shouldn't nuke style.css).
    await writeAppFiles(input.slug, files);

    return {
        slug: input.slug,
        changedFiles: files.map((f) => ({ path: f.path, size: f.content.length })),
        model: APP_GENERATION_MODEL,
        tokens: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
        },
    };
}
