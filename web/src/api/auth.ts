/**
 * /api/auth/* routes — login flow, callback, current-user, logout.
 *
 * The login flow is a server-side OIDC authorization code exchange. The
 * id_token from the exchange is stored verbatim in an HttpOnly cookie; we
 * verify it on every subsequent request via the requireAuth middleware.
 */

import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import {
    buildAuthorizeUrl,
    exchangeCode,
    getConfig,
    verifyJwt,
} from "../auth/oidc.js";
import { SESSION_COOKIE } from "../auth/middleware.js";

const STATE_COOKIE = "rainbow_oauth_state";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const authRouter = Router();

authRouter.get("/login", (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: STATE_MAX_AGE_MS,
    });
    res.redirect(buildAuthorizeUrl(state));
});

authRouter.get("/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState = (req as Request & { cookies?: Record<string, string> })
        .cookies?.[STATE_COOKIE];

    if (!code || !state || !cookieState || state !== cookieState) {
        res.status(400).send("Invalid OAuth callback: state mismatch or missing code");
        return;
    }
    res.clearCookie(STATE_COOKIE);

    try {
        const { idToken } = await exchangeCode(code);
        res.cookie(SESSION_COOKIE, idToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            maxAge: SESSION_MAX_AGE_MS,
        });
        res.redirect("/");
    } catch (err) {
        console.error("[auth] callback failed:", err);
        res.status(500).send("Login failed during token exchange.");
    }
});

authRouter.get("/me", async (req: Request, res: Response) => {
    const cookie = (req as Request & { cookies?: Record<string, string> })
        .cookies?.[SESSION_COOKIE];
    if (!cookie) {
        res.status(401).json({ authenticated: false });
        return;
    }
    try {
        const user = await verifyJwt(cookie);
        res.json({
            authenticated: true,
            user: {
                sub: user.sub,
                email: user.email,
                name: user.name,
                preferredUsername: user.preferredUsername,
            },
        });
    } catch {
        res.status(401).json({ authenticated: false });
    }
});

authRouter.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
});

authRouter.get("/config", (_req: Request, res: Response) => {
    const cfg = getConfig();
    // Public (non-secret) bits only — useful for the dashboard SPA.
    res.json({
        issuer: cfg.issuer,
        clientId: cfg.clientId,
        loginUrl: "/api/auth/login",
        logoutUrl: "/api/auth/logout",
    });
});
