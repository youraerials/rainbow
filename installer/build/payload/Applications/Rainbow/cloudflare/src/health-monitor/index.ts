/**
 * Rainbow Health Monitor — Cloudflare Worker (Cron Triggered)
 *
 * Periodically checks the health of registered Rainbow instances
 * and updates their status in KV.
 */

interface Env {
  SUBDOMAINS: KVNamespace;
}

interface SubdomainData {
  tunnel_id: string;
  owner_email: string;
  dns_record_id: string;
  created_at: string;
  last_check?: string;
  healthy?: boolean;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const keys = await env.SUBDOMAINS.list();

    for (const key of keys.keys) {
      const data = await env.SUBDOMAINS.get(key.name);
      if (!data) continue;

      const subdomain: SubdomainData = JSON.parse(data);
      const domain = `app.${key.name}.rainbow.rocks`;

      try {
        const resp = await fetch(`https://${domain}/`, {
          method: "HEAD",
          signal: AbortSignal.timeout(10000),
        });

        subdomain.healthy = resp.ok;
      } catch {
        subdomain.healthy = false;
      }

      subdomain.last_check = new Date().toISOString();

      await env.SUBDOMAINS.put(key.name, JSON.stringify(subdomain));
    }
  },
};
