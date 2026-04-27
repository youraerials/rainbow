/**
 * Shared authentication utilities for Cloudflare Workers.
 */

/**
 * Verify a bearer token against the stored API secret.
 */
export function verifyBearerToken(
  authHeader: string | undefined,
  apiSecret: string
): { valid: boolean; error?: string } {
  if (!authHeader) {
    return { valid: false, error: "Missing Authorization header" };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Authorization must use Bearer scheme" };
  }

  const token = authHeader.slice(7);
  if (token !== apiSecret) {
    return { valid: false, error: "Invalid token" };
  }

  return { valid: true };
}

/**
 * Generate a simple HMAC-based signature for webhook payloads.
 */
export async function signPayload(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
