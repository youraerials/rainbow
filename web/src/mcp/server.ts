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

import { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

function buildServer(): McpServer {
    const server = new McpServer({
        name: "rainbow",
        version: "0.1.0",
    });

    // Stub tool to verify HTTP transport wiring.
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

    return server;
}

export function attachMcp(app: Express, mountPath: string): void {
    // Stateless HTTP transport: each request creates a fresh transport
    // bound to the same shared McpServer. Good enough for Phase 1; we'll
    // revisit if we need session continuity for streaming responses.
    const server = buildServer();

    app.post(mountPath, async (req: Request, res: Response) => {
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
