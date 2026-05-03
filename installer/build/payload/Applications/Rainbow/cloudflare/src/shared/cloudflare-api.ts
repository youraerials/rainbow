/**
 * Typed Cloudflare API client.
 *
 * Two scopes of operation:
 *   - DNS record CRUD on a zone (via constructor zoneId)
 *   - Tunnel + Email Routing operations on an account (via accountId)
 *
 * The operator-scoped token must include:
 *   - Account: Cloudflare Tunnel: Edit
 *   - Zone: DNS: Edit
 *   - Zone: Email Routing Rules: Edit
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
  priority?: number;
}

interface CfApiResponse<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

export interface TunnelInfo {
  id: string;
  name: string;
  account_tag: string;
  tunnel_secret_was_provided?: boolean;
}

export interface TunnelCredentials {
  AccountTag: string;
  TunnelID: string;
  TunnelName: string;
  TunnelSecret: string;
}

export class CloudflareApi {
  constructor(
    private apiToken: string,
    private zoneId: string,
    private accountId: string,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<CfApiResponse<T>> {
    const response = await fetch(`${CF_API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    return response.json() as Promise<CfApiResponse<T>>;
  }

  // ─── DNS ──────────────────────────────────────────────────────

  async listDnsRecords(name?: string): Promise<DnsRecord[]> {
    const query = name ? `?name=${encodeURIComponent(name)}&per_page=100` : "?per_page=100";
    const resp = await this.request<DnsRecord[]>(
      `/zones/${this.zoneId}/dns_records${query}`,
    );
    return resp.success ? resp.result : [];
  }

  async createDnsRecord(input: {
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
    priority?: number;
    ttl?: number;
  }): Promise<{ success: boolean; record?: DnsRecord; errors?: unknown }> {
    const resp = await this.request<DnsRecord>(
      `/zones/${this.zoneId}/dns_records`,
      {
        method: "POST",
        body: JSON.stringify({
          type: input.type,
          name: input.name,
          content: input.content,
          proxied: input.proxied ?? false,
          priority: input.priority,
          ttl: input.ttl ?? 1,
        }),
      },
    );
    return {
      success: resp.success,
      record: resp.success ? resp.result : undefined,
      errors: resp.errors,
    };
  }

  async deleteDnsRecord(recordId: string): Promise<{ success: boolean }> {
    const resp = await this.request<{ id: string }>(
      `/zones/${this.zoneId}/dns_records/${recordId}`,
      { method: "DELETE" },
    );
    return { success: resp.success };
  }

  /**
   * Create one CNAME per Rainbow service hostname pointing at the tunnel.
   *
   * Hostname layout is intentionally flat at level 1: `<prefix>.<zone>`
   * for the dashboard apex and `<prefix>-<service>.<zone>` for each
   * service. We can't use a single wildcard like `*.<prefix>.<zone>`
   * because that's level-2 and Cloudflare's free Universal SSL doesn't
   * cover it (would fail TLS at the edge before reaching the tunnel).
   * A wildcard at the zone apex (`*.<zone>`) would also work for SSL but
   * would conflict between tenants who share the zone. Per-host CNAMEs
   * keep tenants isolated and TLS working.
   *
   * Returns all created record IDs so /release can clean them up.
   */
  async createTunnelHostnames(input: {
    /** "aubrey" — tenant prefix. */
    prefix: string;
    /** "rainbow.rocks" — parent zone. */
    zone: string;
    /** ["auth", "photos", "mail", ...] — service-suffixed hostnames. */
    services: string[];
    tunnelId: string;
  }): Promise<{ recordIds: string[]; hostnames: string[]; errors: unknown[] }> {
    const tunnelHost = `${input.tunnelId}.cfargotunnel.com`;
    const recordIds: string[] = [];
    const hostnames: string[] = [];
    const errors: unknown[] = [];

    const targets = [
      `${input.prefix}.${input.zone}`, // apex (dashboard)
      ...input.services.map((s) => `${input.prefix}-${s}.${input.zone}`),
    ];

    for (const name of targets) {
      const result = await this.createDnsRecord({
        type: "CNAME",
        name,
        content: tunnelHost,
        proxied: true,
      });
      if (result.success && result.record) {
        recordIds.push(result.record.id);
        hostnames.push(name);
      } else {
        errors.push({ name, errors: result.errors });
      }
    }

    return { recordIds, hostnames, errors };
  }

  // ─── Cloudflare Tunnel ────────────────────────────────────────

  /**
   * Create a Cloudflared Tunnel on the operator's account. Returns the
   * tunnel ID and the credentials JSON the user's machine needs to
   * actually run cloudflared. The tunnel_secret is generated locally and
   * returned as part of the credentials — Cloudflare doesn't echo it back.
   */
  async createTunnel(name: string): Promise<{
    success: boolean;
    info?: TunnelInfo;
    credentials?: TunnelCredentials;
    error?: string;
  }> {
    // 32 bytes random, base64-encoded — Cloudflare requires this exact format.
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const tunnelSecret = arrayToBase64(secretBytes);

    const resp = await this.request<TunnelInfo>(
      `/accounts/${this.accountId}/cfd_tunnel`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          tunnel_secret: tunnelSecret,
          config_src: "local",
        }),
      },
    );
    if (!resp.success) {
      return {
        success: false,
        error: resp.errors?.map((e) => `${e.code}: ${e.message}`).join("; "),
      };
    }
    const info = resp.result;
    const credentials: TunnelCredentials = {
      AccountTag: info.account_tag,
      TunnelID: info.id,
      TunnelName: info.name,
      TunnelSecret: tunnelSecret,
    };
    return { success: true, info, credentials };
  }

  async deleteTunnel(tunnelId: string): Promise<{ success: boolean }> {
    const resp = await this.request<unknown>(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}`,
      { method: "DELETE" },
    );
    return { success: resp.success };
  }

  // ─── Email Routing ────────────────────────────────────────────

  /**
   * Add MX records pointing the named hostname at Cloudflare's Email
   * Routing service. These three priorities are the Cloudflare-published
   * defaults — copying what the Email Routing onboarding wizard does.
   */
  async addCloudflareMxRecords(
    hostname: string,
  ): Promise<{ recordIds: string[]; errors: unknown[] }> {
    const recordIds: string[] = [];
    const errors: unknown[] = [];
    const mx = [
      { content: "route1.mx.cloudflare.net", priority: 13 },
      { content: "route2.mx.cloudflare.net", priority: 86 },
      { content: "route3.mx.cloudflare.net", priority: 24 },
    ];
    for (const r of mx) {
      const result = await this.createDnsRecord({
        type: "MX",
        name: hostname,
        content: r.content,
        priority: r.priority,
        proxied: false,
      });
      if (result.success && result.record) {
        recordIds.push(result.record.id);
      } else {
        errors.push({ content: r.content, errors: result.errors });
      }
    }
    return { recordIds, errors };
  }

  /**
   * Add SPF for Cloudflare's Email Routing on the given hostname.
   * Returns the record ID so the caller can track it for cleanup.
   */
  async addEmailRoutingSpf(
    hostname: string,
  ): Promise<{ success: boolean; recordId?: string }> {
    const result = await this.createDnsRecord({
      type: "TXT",
      name: hostname,
      content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
      proxied: false,
    });
    return {
      success: result.success,
      recordId: result.record?.id,
    };
  }

  /**
   * Catch-all rule for the zone — every address that doesn't match a more
   * specific rule routes to the named Worker. Idempotent (PUT replaces).
   * For multi-tenant Rainbow we want a SINGLE shared Worker that looks
   * up the destination domain in KV to find the right user's tunnel —
   * that way each user's claimed subdomain auto-flows mail without us
   * touching the catch-all per claim.
   */
  async setEmailRoutingCatchAll(
    workerName: string,
  ): Promise<{ success: boolean; error?: string }> {
    const body = {
      enabled: true,
      name: "Rainbow catch-all → email-receiver Worker",
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [workerName] }],
    };
    const resp = await this.request<unknown>(
      `/zones/${this.zoneId}/email/routing/rules/catch_all`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return {
      success: resp.success,
      error: resp.success
        ? undefined
        : resp.errors?.map((e) => `${e.code}: ${e.message}`).join("; "),
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function arrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
