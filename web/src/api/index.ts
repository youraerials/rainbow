/**
 * Admin REST API. For now just /api/health; service status, config writes,
 * etc. land here as Phase 4 lands.
 */

import { Router } from "express";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "rainbow-web",
        timestamp: new Date().toISOString(),
    });
});
