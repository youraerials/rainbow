/**
 * Subdomain validation rules.
 */

/** Reserved subdomains that cannot be claimed */
const RESERVED_NAMES = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "imap",
  "ftp", "ssh", "vpn", "dns", "ns1", "ns2", "cdn",
  "static", "assets", "status", "health", "monitor",
  "test", "staging", "dev", "prod", "beta", "alpha",
  "support", "help", "docs", "blog", "store", "shop",
  "login", "auth", "sso", "oauth", "signup", "register",
  "billing", "payment", "abuse", "postmaster", "hostmaster",
  "webmaster", "security", "noc", "root", "rainbow",
]);

/** Offensive/inappropriate terms */
const BLOCKED_PATTERNS = [
  /^x{3,}/,      // xxx...
  /^test\d*$/,    // test, test1, test123
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateSubdomain(name: string): ValidationResult {
  // Length check
  if (name.length < 3) {
    return { valid: false, error: "Subdomain must be at least 3 characters" };
  }
  if (name.length > 63) {
    return { valid: false, error: "Subdomain must be 63 characters or less" };
  }

  // Character check: lowercase alphanumeric and hyphens
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    return {
      valid: false,
      error: "Subdomain must start and end with a letter or number, and contain only lowercase letters, numbers, and hyphens",
    };
  }

  // No consecutive hyphens
  if (name.includes("--")) {
    return { valid: false, error: "Subdomain cannot contain consecutive hyphens" };
  }

  // Reserved names
  if (RESERVED_NAMES.has(name)) {
    return { valid: false, error: "This subdomain is reserved" };
  }

  // Blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(name)) {
      return { valid: false, error: "This subdomain is not available" };
    }
  }

  return { valid: true };
}
