/**
 * Admin REST API. /api/auth/* is unprotected (it's the login flow itself);
 * everything else requires a valid OIDC session cookie or Bearer token.
 */

import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { authRouter } from "./auth.js";
import { statusRouter } from "./status.js";
import { adminRouter } from "./admin.js";
import { appsRouter } from "./apps.js";

export const apiRouter = Router();

// Auth routes are public — they're how you become authenticated.
apiRouter.use("/auth", authRouter);

// Everything below this point requires authentication.
apiRouter.use(requireAuth);

apiRouter.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "rainbow-web",
        timestamp: new Date().toISOString(),
        user: req.user
            ? {
                  sub: req.user.sub,
                  email: req.user.email,
                  name: req.user.name,
              }
            : null,
    });
});

// /api/status, /api/services — service catalog + live health.
apiRouter.use(statusRouter);

// /api/admin/* — admin config (Anthropic key, etc.)
apiRouter.use("/admin", adminRouter);

// /api/apps/* — list, get, delete apps + per-app key/value data
apiRouter.use("/apps", appsRouter);
