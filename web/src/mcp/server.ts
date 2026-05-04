/**
 * MCP HTTP transport. A single McpServer instance aggregates tools across
 * all Rainbow services; /mcp speaks the streamable HTTP protocol used by
 * modern MCP clients.
 *
 * Phase 1 (this file): one stub tool that pings the web tier itself, just
 *   to verify wire-up.
 * Phase 2/3: import tool registries from the per-service mcp/packages/*
 *   workspace packages and register them all here.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Express, Request, RequestHandler, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerSystemTools } from "./tools/system/index.js";
import { registerPhotoTools } from "./tools/photos/index.js";
import { registerFileTools } from "./tools/files/index.js";
import { registerMediaTools } from "./tools/media/index.js";
import { registerEmailTools } from "./tools/email/index.js";
import { registerCalendarTools } from "./tools/calendar/index.js";
import { registerContactsTools } from "./tools/contacts/index.js";
import type { RainbowUser } from "../auth/oidc.js";

/**
 * Per-request context propagated to tool handlers. Set by attachMcp's
 * Express middleware before transport.handleRequest, read by users.me
 * (and any future tool that needs to know who's calling).
 */
interface McpRequestContext {
    user?: RainbowUser;
}
const requestContext = new AsyncLocalStorage<McpRequestContext>();

export function getCurrentUser(): RainbowUser | undefined {
    return requestContext.getStore()?.user;
}

/**
 * Invoke a registered tool by name. Used by the dashboard's "Try a
 * tool" panel via /api/mcp/call — bypasses JSON-RPC since we're already
 * inside the same process.
 *
 * Validates `args` against the tool's Zod shape if one was registered.
 * Wraps the call in the same AsyncLocalStorage context the gateway
 * uses, so users.me and friends behave identically.
 */
export async function callTool(
    name: string,
    args: Record<string, unknown>,
    user: RainbowUser | undefined,
): Promise<ToolResult> {
    const handler = HANDLERS.get(name);
    if (!handler) {
        return {
            isError: true,
            content: [{ type: "text", text: `unknown tool: ${name}` }],
        };
    }
    let validated: Record<string, unknown> = args ?? {};
    const shape = SHAPES.get(name);
    if (shape && Object.keys(shape).length > 0) {
        const parsed = z.object(shape).safeParse(args ?? {});
        if (!parsed.success) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `invalid arguments: ${parsed.error.message}`,
                    },
                ],
            };
        }
        validated = parsed.data as Record<string, unknown>;
    }
    return await requestContext.run({ user }, async () => {
        try {
            return await handler(validated, {});
        } catch (err) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
                    },
                ],
            };
        }
    });
}

import { z } from "zod";

/**
 * Every tool currently registered on the gateway, with its full metadata.
 * Captured in registration order at boot. Consumed by:
 *   - the app-generation prompt (so Claude knows what each tool does +
 *     what arguments it takes)
 *   - GET /api/mcp/tools (so the dashboard can surface the catalog)
 */
export interface ToolInfo {
    name: string;
    description: string;
    /** JSON Schema for the input. Empty schema = no arguments. */
    inputSchema: Record<string, unknown>;
}

/** Result envelope a tool handler returns. Mirrors the MCP content format. */
export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

// Handlers indexed by tool name, so /api/mcp/call can invoke a tool
// directly (no JSON-RPC round-trip). Same handlers the SDK calls.
type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
const HANDLERS: Map<string, ToolHandler> = new Map();
const SHAPES: Map<string, Record<string, z.ZodType<unknown>>> = new Map();

/**
 * Convert a Zod schema record (the third arg to McpServer.tool) into a
 * JSON Schema. Zod 4 ships `toJSONSchema()` so we just wrap the shape
 * in z.object() and call it — no third-party converter needed.
 */
function shapeToJsonSchema(
    shape: Record<string, z.ZodType<unknown>>,
): Record<string, unknown> {
    return z.object(shape).toJSONSchema() as Record<string, unknown>;
}

const REGISTERED_TOOLS: ToolInfo[] = [];

export function listTools(): ToolInfo[] {
    return REGISTERED_TOOLS.slice();
}

/** Compatibility shim for any caller that just wants names. */
export function listToolNames(): string[] {
    return REGISTERED_TOOLS.map((t) => t.name);
}

function buildServer(): McpServer {
    const server = new McpServer({
        name: "rainbow",
        version: "0.1.0",
    });

    // Wrap server.tool to also record the tool's full metadata for the
    // catalog. The SDK's signature is
    //   server.tool(name, description, schemaShape, handler)
    // — schemaShape is a ZodRawShape (i.e. Record<string, ZodType>),
    // not a ZodObject. Wrap it in z.object() before serializing.
    const originalTool = server.tool.bind(server);
    server.tool = ((...args: unknown[]) => {
        const [name, description, shape] = args as [
            string,
            string,
            Record<string, z.ZodType> | undefined,
            unknown,
        ];
        let inputSchema: Record<string, unknown> = { type: "object" };
        if (shape && typeof shape === "object" && Object.keys(shape).length > 0) {
            try {
                inputSchema = shapeToJsonSchema(shape);
            } catch {
                // Fall through with the empty schema — better to register
                // the tool than to crash boot if a schema can't be
                // serialized for some reason.
            }
        }
        REGISTERED_TOOLS.push({
            name,
            description: typeof description === "string" ? description : "",
            inputSchema,
        });
        // Capture the handler (last positional arg) so /api/mcp/call can
        // invoke this tool directly without going through JSON-RPC.
        const handler = args[args.length - 1];
        if (typeof handler === "function") {
            HANDLERS.set(name, handler as ToolHandler);
        }
        if (shape) SHAPES.set(name, shape);
        // Forward whatever the SDK accepted: we don't reshape the args.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalTool as any)(...args);
    }) as typeof server.tool;

    // Connectivity probe.
    server.tool(
        "rainbow.ping",
        "Verify the MCP gateway is reachable.",
        {},
        async () => ({
            content: [
                {
                    type: "text" as const,
                    text: `pong from rainbow-web at ${new Date().toISOString()}`,
                },
            ],
        }),
    );

    // System tools (health, service catalog). Each register*Tools function
    // adds its own namespace of tools to the shared server.
    registerSystemTools(server);

    // Photos (Immich). Disabled at boot if IMMICH_API_KEY isn't set.
    registerPhotoTools(server);

    // Files (Seafile). Disabled at boot if SEAFILE_API_TOKEN isn't set.
    registerFileTools(server);

    // Media (Jellyfin). Disabled at boot if JELLYFIN_API_KEY isn't set.
    registerMediaTools(server);

    // Email (Stalwart JMAP). Disabled at boot if STALWART_JMAP_USER/PASSWORD
    // aren't set — Stalwart's first-run setup wizard creates that account.
    registerEmailTools(server);

    // Calendar (Stalwart CalDAV). Same creds as email; disabled together.
    registerCalendarTools(server);

    // Contacts (Stalwart CardDAV). Same creds as email; disabled together.
    registerContactsTools(server);

    return server;
}

export function attachMcp(
    app: Express,
    mountPath: string,
    auth: RequestHandler,
): void {
    // Stateless HTTP transport: each request creates a fresh transport
    // bound to the same shared McpServer. Good enough for Phase 1; we'll
    // revisit if we need session continuity for streaming responses.
    const server = buildServer();

    app.post(mountPath, auth, async (req: Request, res: Response) => {
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined, // stateless
            });
            res.on("close", () => transport.close());
            await server.connect(transport);
            // Bind the authenticated user into AsyncLocalStorage for the
            // duration of this request so tools (e.g. users.me) can read
            // it from anywhere in the call stack.
            await requestContext.run(
                { user: req.user },
                () => transport.handleRequest(req, res, req.body),
            );
        } catch (err) {
            console.error("[mcp] request error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal MCP error" },
                    id: null,
                });
            }
        }
    });

    // GET /mcp returns 405 — streamable HTTP transport expects POST. Useful
    // for browser sanity-pings to give a non-blank response.
    app.get(mountPath, (_req, res) => {
        res.status(405).json({
            error: "Method Not Allowed",
            hint: "MCP requires POST with a JSON-RPC body. See https://modelcontextprotocol.io",
        });
    });
}
