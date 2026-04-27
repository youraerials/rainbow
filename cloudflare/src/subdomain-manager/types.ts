/**
 * Types for the subdomain manager worker.
 */

export interface SubdomainClaim {
  tunnel_id: string;
  owner_email: string;
  dns_record_id: string;
  created_at: string;
  last_check?: string;
  healthy?: boolean;
}

export interface ClaimRequest {
  name: string;
  tunnel_id: string;
  owner_email: string;
}

export interface ClaimResponse {
  success: boolean;
  domain: string;
  subdomains: Record<string, string>;
}

export interface CheckResponse {
  name: string;
  available: boolean;
  domain: string;
}

export interface CustomDomainRequest {
  domain: string;
  tunnel_id: string;
  owner_email: string;
}
