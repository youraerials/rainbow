/**
 * Types for the subdomain-manager Worker.
 *
 * The KV record we store per-claim is the source of truth for everything
 * the email-receiver Worker and dashboard later need to know about a user.
 */

export interface SubdomainTenant {
  /** The user-chosen name (`aubrey` for `aubrey.rainbow.rocks`). */
  name: string;
  /** Owner-supplied email — used as the Authentik admin contact. */
  ownerEmail: string;
  /** Cloudflare Tunnel ID we minted for this tenant. */
  tunnelId: string;
  /** Tunnel name in Cloudflare ("rainbow-aubrey"). */
  tunnelName: string;
  /** DNS record IDs we created — needed for clean teardown on /release. */
  dnsRecordIds: string[];
  /** MX record IDs for Email Routing on the tenant's namespace. */
  mxRecordIds: string[];
  /**
   * HMAC secret the email-receiver Worker uses when forwarding mail to
   * the tenant's tunnel. Same value lives in the user's Keychain locally
   * (mirrored at provision time) so /api/inbound-mail can verify.
   */
  inboundMailSecret: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Optional health metadata, set by health-monitor cron later. */
  lastHealthCheck?: string;
  healthy?: boolean;
}

export interface ProvisionRequest {
  /** "aubrey" — claimed subdomain prefix under rainbow.rocks. */
  name: string;
  /** "you@example.com" — used for Authentik admin user, contact, etc. */
  ownerEmail: string;
}

export interface ProvisionResponse {
  success: boolean;
  /** Full apex of the tenant's namespace, e.g. `aubrey.rainbow.rocks`. */
  domain: string;
  /**
   * Every level-1 hostname we created CNAMEs for, in order — apex first,
   * then `<prefix>-<service>.<zone>` per service. The user's machine uses
   * this list to render its cloudflared ingress config.
   */
  serviceHostnames: string[];
  tunnel: {
    id: string;
    name: string;
    /**
     * Credentials JSON the user's Mac writes to
     * `~/.cloudflared/<id>.json`. Identical shape to what `cloudflared
     * tunnel create` produces locally. Returned ONCE — Cloudflare doesn't
     * echo the secret, so if you lose this you have to re-provision.
     */
    credentials: {
      AccountTag: string;
      TunnelID: string;
      TunnelName: string;
      TunnelSecret: string;
    };
  };
  /** HMAC secret for the inbound-mail bridge — store in local Keychain. */
  inboundMailSecret: string;
}
