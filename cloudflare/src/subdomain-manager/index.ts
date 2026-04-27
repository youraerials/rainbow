/**
 * Rainbow Subdomain Manager — Cloudflare Worker
 *
 * Manages *.rainbow.rocks subdomains for Rainbow users.
 * Routes:
 *   POST   /claim          — Claim a subdomain
 *   DELETE /release/:name  — Release a subdomain
 *   GET    /check/:name    — Check subdomain availability
 *   POST   /custom-domain  — Configure a custom domain
 *   GET    /status/:name   — Get subdomain status/health
 */

import { Hono } from "hono";
import { verifyBearerToken } from "../shared/auth";
import { CloudflareApi } from "../shared/cloudflare-api";
import { validateSubdomain } from "./validation";
import type { SubdomainClaim, ClaimRequest, CustomDomainRequest } from "./types";

type Bindings = {
  SUBDOMAINS: KVNamespace;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
  ALLOWED_PARENT_DOMAIN: string;
  API_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ─── Auth middleware ───��────────────────────────────────────────
app.use("*", async (c, next) => {
  // Allow health check without auth
  if (c.req.path === "/health") return next();

  const result = verifyBearerToken(
    c.req.header("Authorization"),
    c.env.API_SECRET
  );
  if (!result.valid) {
    return c.json({ error: result.error }, 401);
  }
  await next();
});

// ─── Health check ──────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ─── Check availability ────────────────────────────────────────
app.get("/check/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();

  const validation = validateSubdomain(name);
  if (!validation.valid) {
    return c.json({ error: validation.error, available: false }, 400);
  }

  const existing = await c.env.SUBDOMAINS.get(name);
  return c.json({
    name,
    available: existing === null,
    domain: `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`,
  });
});

// ─── Get subdomain status ──────────────────────────────────────
app.get("/status/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const data = await c.env.SUBDOMAINS.get(name);

  if (!data) {
    return c.json({ error: "Subdomain not found" }, 404);
  }

  const claim: SubdomainClaim = JSON.parse(data);
  return c.json({
    name,
    domain: `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`,
    created_at: claim.created_at,
    last_check: claim.last_check,
    healthy: claim.healthy,
  });
});

// ─── Claim a subdomain ─────────────────────────────────────────
app.post("/claim", async (c) => {
  const body = await c.req.json<ClaimRequest>();

  const name = body.name?.toLowerCase();
  if (!name || !body.tunnel_id || !body.owner_email) {
    return c.json(
      { error: "Missing required fields: name, tunnel_id, owner_email" },
      400
    );
  }

  const validation = validateSubdomain(name);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // Check availability
  const existing = await c.env.SUBDOMAINS.get(name);
  if (existing !== null) {
    return c.json({ error: "Subdomain already claimed" }, 409);
  }

  const baseDomain = `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`;
  const cfApi = new CloudflareApi(
    c.env.CLOUDFLARE_API_TOKEN,
    c.env.CLOUDFLARE_ZONE_ID
  );

  // Create wildcard DNS records for all service subdomains
  const dnsResult = await cfApi.createWildcardCname(baseDomain, body.tunnel_id);

  if (!dnsResult.success) {
    return c.json({ error: "Failed to create DNS records" }, 500);
  }

  // Store claim in KV
  const claim: SubdomainClaim = {
    tunnel_id: body.tunnel_id,
    owner_email: body.owner_email,
    dns_record_id: "", // Multiple records created
    created_at: new Date().toISOString(),
  };

  await c.env.SUBDOMAINS.put(name, JSON.stringify(claim));

  const subdomains: Record<string, string> = {};
  for (const prefix of ["app", "photos", "mail", "files", "docs", "media", "auth", "api"]) {
    subdomains[prefix] = `${prefix}.${baseDomain}`;
  }

  return c.json({
    success: true,
    domain: baseDomain,
    subdomains,
    dns_records_created: dnsResult.records.length,
  });
});

// ─── Release a subdomain ─��─────────────────────────────────────
app.delete("/release/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();

  const existing = await c.env.SUBDOMAINS.get(name);
  if (existing === null) {
    return c.json({ error: "Subdomain not found" }, 404);
  }

  const baseDomain = `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`;
  const cfApi = new CloudflareApi(
    c.env.CLOUDFLARE_API_TOKEN,
    c.env.CLOUDFLARE_ZONE_ID
  );

  // Delete all DNS records for this subdomain
  const records = await cfApi.listDnsRecords();
  for (const record of records) {
    if (record.name === baseDomain || record.name.endsWith(`.${baseDomain}`)) {
      await cfApi.deleteDnsRecord(record.id);
    }
  }

  await c.env.SUBDOMAINS.delete(name);
  return c.json({ success: true, released: name });
});

// ─── Configure custom domain ───────────────────────────────────
app.post("/custom-domain", async (c) => {
  const body = await c.req.json<CustomDomainRequest>();

  if (!body.domain || !body.tunnel_id || !body.owner_email) {
    return c.json(
      { error: "Missing required fields: domain, tunnel_id, owner_email" },
      400
    );
  }

  // For custom domains, the user manages their own DNS.
  // We just store the mapping so we know about it.
  await c.env.SUBDOMAINS.put(
    `custom:${body.domain}`,
    JSON.stringify({
      tunnel_id: body.tunnel_id,
      owner_email: body.owner_email,
      dns_record_id: "",
      created_at: new Date().toISOString(),
    } satisfies SubdomainClaim)
  );

  return c.json({
    success: true,
    domain: body.domain,
    instructions: {
      message: "Add these CNAME records to your DNS provider:",
      records: [
        { type: "CNAME", name: body.domain, value: `${body.tunnel_id}.cfargotunnel.com` },
        { type: "CNAME", name: `*.${body.domain}`, value: `${body.tunnel_id}.cfargotunnel.com` },
      ],
    },
  });
});

export default app;
