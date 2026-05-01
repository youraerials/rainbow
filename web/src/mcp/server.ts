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

import { Express, Request, RequestHandler, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerSystemTools } from "./tools/system/index.js";

function buildServer(): McpServer {
    const server = new McpServer({
        name: "rainbow",
        version: "0.1.0",
    });

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
    // adds its own namespace of tools to the shared server; Phase 3 follows
    // the same pattern for mcp-photos, mcp-files, etc.
    registerSystemTools(server);

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
            await transport.handleRequest(req, res, req.body);
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
