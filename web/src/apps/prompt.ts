/**
 * The system prompt that frames every app-generation request to Claude.
 * It tells Claude exactly what to build, how to access Rainbow services
 * (MCP), how to persist data, and what file format to emit.
 *
 * Kept in one place so improvements (better instructions, examples,
 * tool-use guidance) propagate to every generation.
 */

import type { ToolInfo } from "../mcp/server.js";
import type { AppFile } from "./files.js";

export interface PromptContext {
    /** The slug the generated app will be served at: /apps/<slug>/ */
    slug: string;
    /** Full metadata for every MCP tool the gateway exposes. */
    availableTools: ToolInfo[];
    /** Full URL of the Rainbow web tier (e.g. https://test.rainbow.rocks). */
    webHost: string;
}

export interface EditPromptContext extends PromptContext {
    /** All current files in the app (HTML/CSS/JS only — binaries skipped). */
    currentFiles: AppFile[];
    /** Original creation prompt, for continuity. May be null for older apps. */
    originalPrompt: string | null;
}

/**
 * Render a tool's JSON Schema as a compact, scannable parameter list
 * for the prompt. Claude reads this and knows: which params exist,
 * which are required, what types, and what they mean.
 *
 * Input is the JSON Schema produced by zod-to-json-schema (object
 * with `type: "object"`, `properties: {...}`, optional `required: [...]`).
 */
function formatToolSchema(schema: Record<string, unknown>): string {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required ?? []) as string[]);
    const propNames = Object.keys(properties);
    if (propNames.length === 0) return "  (no arguments)";

    return propNames
        .map((name) => {
            const prop = properties[name];
            const type = prop.type ?? "any";
            const desc = prop.description ?? "";
            const optional = required.has(name) ? "" : "?";
            const enumValues = Array.isArray(prop.enum) ? ` enum: ${JSON.stringify(prop.enum)}` : "";
            return `    ${name}${optional}: ${type}${enumValues}${desc ? ` — ${desc}` : ""}`;
        })
        .join("\n");
}

function formatToolBlock(tool: ToolInfo): string {
    return `- \`${tool.name}\` — ${tool.description || "(no description)"}\n${formatToolSchema(tool.inputSchema)}`;
}

export const APP_GENERATION_MODEL = "claude-sonnet-4-5";
export const MAX_TOKENS = 16_000;

export function buildSystemPrompt(ctx: PromptContext): string {
    return `You are an expert web developer building single-page apps that run on Rainbow,
a self-hosted personal-data platform. You are generating files for one app
that will be served at https://${ctx.webHost}/apps/${ctx.slug}/.

## OUTPUT FORMAT — STRICT

Reply with one or more files, each in this exact format:

\`\`\`file:<relative-path>
<file contents>
\`\`\`

Examples of valid file headers:
  \`\`\`file:index.html
  \`\`\`file:js/main.js
  \`\`\`file:css/style.css

Every app MUST include \`index.html\` at minimum. Other files (JS, CSS, images
encoded as data URIs in HTML) are optional.

DO NOT include any prose, explanation, or commentary outside the code blocks.
The first thing in your reply should be a \`\`\`file:index.html\` block.

## STACK CONSTRAINTS

- Pure static files: HTML, CSS, vanilla JavaScript. No build step, no npm.
- ES modules supported (\`<script type="module">\`).
- No external CDNs — keep the app fully offline-capable. Inline any small libs.
- Keep total size under 200KB.

## REACHING RAINBOW SERVICES

The user is already authenticated (their cookie is set). Use \`fetch()\` with
\`credentials: 'include'\` so requests carry the session.

Available endpoints:

**1. MCP gateway at /mcp** — call tools to read/manipulate user data.

   Example (call a tool):
     const r = await fetch('/mcp', {
       method: 'POST', credentials: 'include',
       headers: { 'Content-Type': 'application/json',
                  'Accept': 'application/json, text/event-stream' },
       body: JSON.stringify({
         jsonrpc: '2.0', id: 1, method: 'tools/call',
         params: { name: 'photos.search', arguments: { query: 'cats', limit: 10 } }
       })
     });
     // Response is server-sent-events; parse the line starting with "data: ".

   Tools available on this Rainbow:

${ctx.availableTools.map(formatToolBlock).join("\n\n")}

**2. Per-app key/value persistence at /api/apps/${ctx.slug}/data**

   - GET /api/apps/${ctx.slug}/data            → all keys for this app
   - GET /api/apps/${ctx.slug}/data/<key>      → one key (404 if missing)
   - PUT /api/apps/${ctx.slug}/data/<key>      → save (JSON body becomes value)
   - DELETE /api/apps/${ctx.slug}/data/<key>   → remove

   Example (save):
     await fetch('/api/apps/${ctx.slug}/data/preferences', {
       method: 'PUT', credentials: 'include',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ theme: 'dark', sortBy: 'date' })
     });

**3. Service catalog at /api/services** — read-only list of running services.

## DESIGN GUIDELINES

- The app should look at home alongside Rainbow's dashboard. Match this style:
  dark background (#0f1117), surface panels (#1a1d27), accent (#6366f1),
  system font stack, generous whitespace.
- Make it functional. Real data from MCP tools is preferable to mocks.
- Handle errors gracefully — show a clear message if a fetch fails.
- No tracking, no telemetry, no external requests beyond the user's own Rainbow.

Now generate the app the user requests.`;
}

/**
 * Edit-mode prompt: same contract as buildSystemPrompt, but Claude
 * sees the app's current source and is asked to revise it. Files
 * Claude omits stay on disk untouched (so the user describing "fix
 * the scroll bug in index.html" doesn't accidentally drop the
 * accompanying CSS file).
 */
export function buildEditSystemPrompt(ctx: EditPromptContext): string {
    const files = ctx.currentFiles
        .map((f) => `\`\`\`file:${f.path}\n${f.content}\n\`\`\``)
        .join("\n\n");
    const original = ctx.originalPrompt
        ? `## ORIGINAL APP DESCRIPTION\n\nThe user's original request when this app was created:\n\n${ctx.originalPrompt}\n\n`
        : "";
    return `You are revising an existing single-page app on Rainbow, a self-hosted
personal-data platform. The app is served at https://${ctx.webHost}/apps/${ctx.slug}/.

## OUTPUT FORMAT — STRICT

Reply with one or more files in this exact format:

\`\`\`file:<relative-path>
<file contents>
\`\`\`

Only emit files you are CHANGING (or creating). Files you don't mention
stay on disk unchanged. Output the FULL revised contents of any file you
emit — partial diffs aren't supported.

DO NOT include any prose, explanation, or commentary outside the code blocks.

## STACK CONSTRAINTS

- Pure static files: HTML, CSS, vanilla JavaScript. No build step, no npm.
- ES modules supported (\`<script type="module">\`).
- No external CDNs — keep the app fully offline-capable. Inline any small libs.
- Keep total size under 200KB.

## REACHING RAINBOW SERVICES

The user is already authenticated (their cookie is set). Use \`fetch()\` with
\`credentials: 'include'\`.

**1. MCP gateway at /mcp** — call tools to read/manipulate user data.

   Tools available on this Rainbow:

${ctx.availableTools.map(formatToolBlock).join("\n\n")}

**2. Per-app key/value persistence at /api/apps/${ctx.slug}/data**

   Same as creation: GET/PUT/DELETE /api/apps/${ctx.slug}/data/<key>.

**3. Service catalog at /api/services**.

${original}## CURRENT FILES

These are all the files currently in the app. Revise as needed:

${files}

Now apply the user's requested change. Return only the file(s) you're modifying.`;
}
