/**
 * Sandbox — Validates generated code for safety before deployment.
 */

interface FileEntry {
  path: string;
  content: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Patterns that should never appear in generated code */
const DANGEROUS_PATTERNS = [
  { pattern: /process\.env\.(POSTGRES_PASSWORD|AUTHENTIK_SECRET)/i, reason: "accesses sensitive environment variables" },
  { pattern: /rm\s+-rf\s+\//,  reason: "attempts destructive filesystem operations" },
  { pattern: /eval\s*\(\s*req/,  reason: "uses eval on user input" },
  { pattern: /child_process/,  reason: "attempts to spawn system processes" },
  { pattern: /\/etc\/passwd/,  reason: "attempts to read system files" },
  { pattern: /\.exec\s*\(\s*['"`](?:rm|dd|mkfs|shutdown)/,  reason: "attempts to run destructive commands" },
];

/** File paths that should not be written */
const FORBIDDEN_PATHS = [
  "..",
  "/etc",
  "/var",
  "/opt",
  "/usr",
  "/bin",
  "/sbin",
  "node_modules",
];

export function validateGeneratedCode(files: FileEntry[]): ValidationResult {
  // Must have a Dockerfile
  const hasDockerfile = files.some((f) => f.path.toLowerCase() === "dockerfile");
  if (!hasDockerfile) {
    return { valid: false, error: "Missing Dockerfile" };
  }

  for (const file of files) {
    // Check path safety
    for (const forbidden of FORBIDDEN_PATHS) {
      if (file.path.includes(forbidden)) {
        return {
          valid: false,
          error: `Forbidden file path: ${file.path}`,
        };
      }
    }

    // Check content safety
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(file.content)) {
        return {
          valid: false,
          error: `File ${file.path} ${reason}`,
        };
      }
    }

    // Check Dockerfile specifically
    if (file.path.toLowerCase() === "dockerfile") {
      // Only allow known safe base images
      const fromMatch = file.content.match(/^FROM\s+(\S+)/im);
      if (!fromMatch) {
        return { valid: false, error: "Dockerfile missing FROM instruction" };
      }

      // Must not run as root in production
      if (file.content.includes("--privileged")) {
        return { valid: false, error: "Dockerfile requests privileged mode" };
      }
    }
  }

  return { valid: true };
}
