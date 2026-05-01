/**
 * Express middleware enforcing OIDC authentication on protected routes.
 *
 * Accepts either:
 *   - `Authorization: Bearer <jwt>` (machine clients, MCP)
 *   - `rainbow_session` cookie (browser flow, set by /api/auth/callback)
 *
 * Both cases verify the JWT against Authentik's JWKS via verifyJwt().
 * On success, attaches the user to req.user and calls next(); otherwise 401.
 */

import { Request, Response, NextFunction } from "express";
import { verifyJwt, RainbowUser } from "./oidc.js";

declare module "express-serve-static-core" {
    interface Request {
        user?: RainbowUser;
    }
}

export const SESSION_COOKIE = "rainbow_session";

function extractToken(req: Request): string | null {
    const auth = req.header("authorization");
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
    return cookie ?? null;
}

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const token = extractToken(req);
    if (!token) {
        res.status(401).json({
            error: "unauthenticated",
            hint: "send Authorization: Bearer <jwt> or set the rainbow_session cookie via /api/auth/login",
        });
        return;
    }
    try {
        req.user = await verifyJwt(token);
        next();
    } catch (err) {
        res.status(401).json({
            error: "invalid token",
            detail: err instanceof Error ? err.message : String(err),
        });
    }
}
