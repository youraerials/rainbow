/**
 * Typed Cloudflare API client for DNS operations.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

interface CfApiResponse<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

export class CloudflareApi {
  constructor(
    private apiToken: string,
    private zoneId: string
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {}
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

  async listDnsRecords(name?: string): Promise<DnsRecord[]> {
    const query = name ? `?name=${encodeURIComponent(name)}` : "";
    const resp = await this.request<DnsRecord[]>(
      `/zones/${this.zoneId}/dns_records${query}`
    );
    return resp.success ? resp.result : [];
  }

  async createDnsRecord(
    type: string,
    name: string,
    content: string,
    proxied = true
  ): Promise<{ success: boolean; record?: DnsRecord; errors?: unknown }> {
    const resp = await this.request<DnsRecord>(
      `/zones/${this.zoneId}/dns_records`,
      {
        method: "POST",
        body: JSON.stringify({ type, name, content, proxied, ttl: 1 }),
      }
    );
    return {
      success: resp.success,
      record: resp.success ? resp.result : undefined,
      errors: resp.errors,
    };
  }

  async updateDnsRecord(
    recordId: string,
    type: string,
    name: string,
    content: string,
    proxied = true
  ): Promise<{ success: boolean }> {
    const resp = await this.request<DnsRecord>(
      `/zones/${this.zoneId}/dns_records/${recordId}`,
      {
        method: "PUT",
        body: JSON.stringify({ type, name, content, proxied, ttl: 1 }),
      }
    );
    return { success: resp.success };
  }

  async deleteDnsRecord(recordId: string): Promise<{ success: boolean }> {
    const resp = await this.request<{ id: string }>(
      `/zones/${this.zoneId}/dns_records/${recordId}`,
      { method: "DELETE" }
    );
    return { success: resp.success };
  }

  /**
   * Create wildcard CNAME for all service subdomains.
   * e.g., *.username.rainbow.rocks -> tunnel-id.cfargotunnel.com
   */
  async createWildcardCname(
    baseDomain: string,
    tunnelId: string
  ): Promise<{ success: boolean; records: string[] }> {
    const tunnelHost = `${tunnelId}.cfargotunnel.com`;
    const created: string[] = [];

    // Base domain CNAME
    const baseResult = await this.createDnsRecord("CNAME", baseDomain, tunnelHost);
    if (baseResult.success) created.push(baseDomain);

    // Service subdomains
    const subdomains = [
      "app", "photos", "mail", "files", "docs", "docs-sandbox",
      "media", "auth", "api", "mc",
    ];

    for (const sub of subdomains) {
      const fullName = `${sub}.${baseDomain}`;
      const result = await this.createDnsRecord("CNAME", fullName, tunnelHost);
      if (result.success) created.push(fullName);
    }

    return { success: created.length > 0, records: created };
  }
}
