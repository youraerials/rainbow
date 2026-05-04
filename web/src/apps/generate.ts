/**
 * Drives Claude through one app-generation request:
 *   1. Read the user's prompt + slug.
 *   2. Pull the Anthropic API key from web_config.
 *   3. Discover currently-registered MCP tools (so the prompt lists what
 *      the generated app can call).
 *   4. Build the system prompt; ask Claude with the user's prompt as input.
 *   5. Parse the response into files; write them to disk; insert metadata.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getConfigValue } from "../db/config.js";
import { createApp } from "../db/apps.js";
import { listTools } from "../mcp/server.js";
import { buildSystemPrompt, APP_GENERATION_MODEL, MAX_TOKENS } from "./prompt.js";
import { parseGeneratedFiles, hasIndexHtml } from "./parse.js";
import {
    isValidSlug,
    appExists,
    writeAppFiles,
    removeAppFiles,
} from "./files.js";

const ANTHROPIC_KEY_CONFIG = "anthropic.api_key";

export interface GenerateInput {
    slug: string;
    name: string;
    prompt: string;
    description?: string;
    generatedBy?: string;
    webHost: string;
}

export interface GenerateResult {
    slug: string;
    files: { path: string; size: number }[];
    model: string;
    tokens: { input: number; output: number };
}

export async function generateApp(input: GenerateInput): Promise<GenerateResult> {
    if (!isValidSlug(input.slug)) {
        throw new Error(
            `slug "${input.slug}" is invalid (lowercase a-z 0-9 - _, max 64 chars, must start with a-z 0-9)`,
        );
    }
    if (await appExists(input.slug)) {
        throw new Error(`app "${input.slug}" already exists; delete it first`);
    }

    const apiKey = await getConfigValue<string>(ANTHROPIC_KEY_CONFIG);
    if (typeof apiKey !== "string" || !apiKey) {
        throw new Error(
            "no Anthropic API key configured. PUT /api/admin/anthropic-key first.",
        );
    }

    const tools = listTools();
    const systemPrompt = buildSystemPrompt({
        slug: input.slug,
        availableTools: tools,
        webHost: input.webHost,
    });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
        model: APP_GENERATION_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
            {
                role: "user",
                content: `App name: ${input.name}\n\nApp description / requirements:\n${input.prompt}`,
            },
        ],
    });

    // Concatenate all text content blocks; ignore tool-use blocks (we don't
    // give Claude tools for this generation step).
    const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n");

    const files = parseGeneratedFiles(text);
    if (!hasIndexHtml(files)) {
        throw new Error(
            `Claude's response did not include an index.html. Got ${files.length} files: ${files.map((f) => f.path).join(", ") || "(none)"}.\n\n--- response start ---\n${text.slice(0, 500)}\n--- response truncated ---`,
        );
    }

    await writeAppFiles(input.slug, files);

    try {
        await createApp({
            slug: input.slug,
            name: input.name,
            description: input.description,
            prompt: input.prompt,
            generatedBy: input.generatedBy,
            model: APP_GENERATION_MODEL,
        });
    } catch (err) {
        // Roll back the on-disk files if metadata insert failed.
        await removeAppFiles(input.slug).catch(() => undefined);
        throw err;
    }

    return {
        slug: input.slug,
        files: files.map((f) => ({ path: f.path, size: f.content.length })),
        model: APP_GENERATION_MODEL,
        tokens: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
        },
    };
}
