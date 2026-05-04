/**
 * Rainbow Subdomain Manager — Cloudflare Worker
 *
 * Provisions everything a Rainbow user needs to run their stack under
 * `<name>.rainbow.rocks`:
 *   - A Cloudflare Tunnel on the operator's account (returns credentials)
 *   - DNS records (apex + wildcard CNAMEs) pointing at the tunnel
 *   - MX records for Cloudflare Email Routing
 *   - Catch-all routing rule → shared email-receiver Worker
 *   - A per-tenant HMAC secret used by the email-receiver Worker to
 *     authenticate mail forwarded to the user's tunnel
 *
 * Public routes:
 *   GET    /health                — unauth, liveness only
 *   GET    /check/:name           — is this name available?
 *   POST   /provision             — full setup (returns tunnel creds)
 *   DELETE /release/:name         — teardown (auth required)
 *
 * Auth: routes that mutate require Bearer API_SECRET. The setup-mode
 * container on the user's Mac has this secret baked in at install time
 * (TODO: move to a per-install short-lived token).
 */

import { Hono } from "hono";
import { verifyBearerToken } from "../shared/auth";
import { CloudflareApi } from "../shared/cloudflare-api";
import { validateSubdomain } from "./validation";
import type {
  ProvisionRequest,
  ProvisionResponse,
  SubdomainTenant,
} from "./types";

/**
 * Canonical list of Rainbow services. Each gets a level-1 CNAME of the
 * form `<prefix>-<service>.<zone>`. The dashboard apex is created
 * separately as `<prefix>.<zone>` (no service suffix). Adding a new
 * service to Rainbow means adding it here AND to the Caddyfile +
 * cloudflared templates on the user's machine.
 */
const RAINBOW_SERVICES = [
  "auth",
  "photos",
  "mail",
  "webmail",
  "files",
  "docs",
  "docs-sandbox",
  "media",
  "api",
] as const;

type Bindings = {
  SUBDOMAINS: KVNamespace;
  /** Operator's Cloudflare API token — Account:Tunnel:Edit, Zone:DNS:Edit, Zone:Email Routing Rules:Edit. */
  CLOUDFLARE_OPERATOR_TOKEN: string;
  /** rainbow.rocks zone ID. */
  CLOUDFLARE_ZONE_ID: string;
  /** Operator's Cloudflare account ID. */
  CLOUDFLARE_ACCOUNT_ID: string;
  /** Shared secret protecting /provision and /release. */
  API_SECRET: string;
  /** rainbow.rocks. */
  ALLOWED_PARENT_DOMAIN: string;
  /** Email-receiver Worker name (the catch-all action target). */
  EMAIL_RECEIVER_WORKER: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ─── Auth middleware (mutating routes only) ─────────────────────
app.use("*", async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;
  const isPublic =
    path === "/health" ||
    (method === "GET" && path.startsWith("/check/"));
  if (isPublic) return next();

  const result = verifyBearerToken(
    c.req.header("Authorization"),
    c.env.API_SECRET,
  );
  if (!result.valid) {
    return c.json({ error: result.error }, 401);
  }
  await next();
});

// ─── Liveness ───────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ─── Availability check ────────────────────────────────────────
app.get("/check/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const v = validateSubdomain(name);
  if (!v.valid) return c.json({ available: false, error: v.error }, 400);
  const existing = await c.env.SUBDOMAINS.get(name);
  return c.json({
    name,
    available: existing === null,
    domain: `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`,
  });
});

// ─── Provision a subdomain ─────────────────────────────────────
// Single endpoint that does everything atomically (best-effort: on partial
// failure we attempt rollback). The user's setup-mode container calls
// this once and gets back tunnel credentials + HMAC secret.
app.post("/provision", async (c) => {
  const body = await c.req.json<ProvisionRequest>();
  const name = body.name?.toLowerCase().trim();
  const ownerEmail = body.ownerEmail?.trim();

  if (!name || !ownerEmail) {
    return c.json({ error: "name and ownerEmail are required" }, 400);
  }
  const v = validateSubdomain(name);
  if (!v.valid) return c.json({ error: v.error }, 400);
  if (!ownerEmail.includes("@")) {
    return c.json({ error: "ownerEmail must look like an email" }, 400);
  }

  // Already claimed?
  const existing = await c.env.SUBDOMAINS.get(name);
  if (existing !== null) {
    return c.json({ error: "subdomain already claimed" }, 409);
  }

  const baseDomain = `${name}.${c.env.ALLOWED_PARENT_DOMAIN}`;
  const cf = new CloudflareApi(
    c.env.CLOUDFLARE_OPERATOR_TOKEN,
    c.env.CLOUDFLARE_ZONE_ID,
    c.env.CLOUDFLARE_ACCOUNT_ID,
  );

  // Track everything we create so we can roll back on failure.
  const created: {
    tunnelId?: string;
    dnsRecordIds: string[];
    mxRecordIds: string[];
  } = { dnsRecordIds: [], mxRecordIds: [] };
  const rollback = async (reason: string) => {
    console.error(`[provision] rolling back ${name}: ${reason}`);
    for (const id of created.dnsRecordIds) {
      await cf.deleteDnsRecord(id);
    }
    for (const id of created.mxRecordIds) {
      await cf.deleteDnsRecord(id);
    }
    if (created.tunnelId) {
      await cf.deleteTunnel(created.tunnelId);
    }
  };

  // 1. Tunnel
  // Defensive cleanup: if a tunnel with this exact name already exists
  // on the operator account, it's an orphan from a previous install
  // whose /release didn't finish (or was never called). Delete it so
  // createTunnel doesn't fail with 1013 "You already have a tunnel
  // with this name". Safe to do here unconditionally — KV said the
  // subdomain is unclaimed, so any existing tunnel by this name has
  // no live tenant.
  const tunnelName = `rainbow-${name}`;
  const orphan = await cf.findTunnelByName(tunnelName);
  if (orphan) {
    console.warn(`[provision] cleaning up orphan tunnel ${tunnelName} (id=${orphan.id})`);
    await cf.deleteTunnel(orphan.id);
  }

  const tunnel = await cf.createTunnel(tunnelName);
  if (!tunnel.success || !tunnel.info || !tunnel.credentials) {
    return c.json(
      { error: `tunnel creation failed: ${tunnel.error ?? "unknown"}` },
      502,
    );
  }
  created.tunnelId = tunnel.info.id;

  // 2. DNS — one level-1 CNAME per Rainbow service plus the dashboard
  //    apex. We can't use a wildcard at level 2 because Cloudflare's
  //    Universal SSL only covers level-1 subdomains for free.
  const cnames = await cf.createTunnelHostnames({
    prefix: name,
    zone: c.env.ALLOWED_PARENT_DOMAIN,
    services: [...RAINBOW_SERVICES],
    tunnelId: tunnel.info.id,
  });
  created.dnsRecordIds.push(...cnames.recordIds);
  if (cnames.errors.length > 0) {
    await rollback(`DNS errors: ${JSON.stringify(cnames.errors)}`);
    return c.json(
      { error: "DNS provisioning failed", details: cnames.errors },
      502,
    );
  }

  // 3. MX records on the tenant's namespace so Cloudflare Email Routing
  //    accepts mail for `<anything>@<name>.rainbow.rocks`. Email Routing
  //    on the parent zone is a one-time setup the operator did already;
  //    here we just bind the subdomain into it via MX.
  const mx = await cf.addCloudflareMxRecords(baseDomain);
  created.mxRecordIds.push(...mx.recordIds);
  if (mx.errors.length > 0) {
    await rollback(`MX errors: ${JSON.stringify(mx.errors)}`);
    return c.json(
      { error: "MX record provisioning failed", details: mx.errors },
      502,
    );
  }

  // 4. SPF — best-effort. Failure not fatal. Track its record ID with the
  //    other DNS records so /release cleans it up.
  const spf = await cf.addEmailRoutingSpf(baseDomain);
  if (spf.success && spf.recordId) {
    created.dnsRecordIds.push(spf.recordId);
  }

  // 5. Per-tenant HMAC secret (32 bytes hex) for the email-receiver
  //    Worker → tunnel handoff. Returned to the caller once and never
  //    again; they're responsible for storing it locally.
  const inboundSecret = randomHex(32);

  const tenant: SubdomainTenant = {
    name,
    ownerEmail,
    tunnelId: tunnel.info.id,
    tunnelName: tunnel.info.name,
    dnsRecordIds: created.dnsRecordIds,
    mxRecordIds: created.mxRecordIds,
    inboundMailSecret: inboundSecret,
    createdAt: new Date().toISOString(),
  };

  await c.env.SUBDOMAINS.put(name, JSON.stringify(tenant));

  // The catch-all rule pointing at the shared email-receiver Worker is
  // set ONCE per zone (operator-side bootstrap, not per-tenant). We don't
  // touch it here; the email-receiver Worker reads SUBDOMAINS KV to know
  // where each incoming message should go.

  const response: ProvisionResponse = {
    success: true,
    domain: baseDomain,
    serviceHostnames: cnames.hostnames,
    tunnel: {
      id: tunnel.info.id,
      name: tunnel.info.name,
      credentials: tunnel.credentials,
    },
    inboundMailSecret: inboundSecret,
  };
  return c.json(response);
});

// ─── Release a subdomain ──────────────────────────────────────
app.delete("/release/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const raw = await c.env.SUBDOMAINS.get(name);
  if (!raw) return c.json({ error: "not found" }, 404);
  const tenant = JSON.parse(raw) as SubdomainTenant;

  const cf = new CloudflareApi(
    c.env.CLOUDFLARE_OPERATOR_TOKEN,
    c.env.CLOUDFLARE_ZONE_ID,
    c.env.CLOUDFLARE_ACCOUNT_ID,
  );

  // Best-effort cleanup: log but don't abort if any individual call
  // fails. The worst outcome of a partial cleanup is a stranded DNS
  // record or tunnel — fixable by reissuing /release or via the
  // dashboard. The worst outcome of FAILING the whole release because
  // of one bad call is a phantom KV claim that nothing can clear,
  // which permanently bricks the subdomain.
  const partialFailures: string[] = [];
  for (const id of [...tenant.dnsRecordIds, ...tenant.mxRecordIds]) {
    const r = await cf.deleteDnsRecord(id);
    if (!r.success) partialFailures.push(`dns ${id}`);
  }
  const tunnelRes = await cf.deleteTunnel(tenant.tunnelId);
  if (!tunnelRes.success) partialFailures.push(`tunnel ${tenant.tunnelId}`);

  // Always wipe the KV record so the subdomain is reclaimable.
  await c.env.SUBDOMAINS.delete(name);

  if (partialFailures.length > 0) {
    console.warn(`[release] ${name} had partial failures:`, partialFailures);
  }
  return c.json({
    success: true,
    released: name,
    ...(partialFailures.length > 0 ? { partialFailures } : {}),
  });
});

// ─── Helpers ──────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default app;
