/**
 * Compute the public Rainbow service hostnames from the env that the
 * orchestrator passes in (RAINBOW_HOST_PREFIX + RAINBOW_ZONE). Used by the
 * system tools to reach each backend over the same path the user's browser
 * does — through Cloudflare's edge and back through the tunnel.
 *
 * Internal-network IP discovery would be faster, but it'd duplicate the
 * orchestrator's IP-substitution work and create a separate routing
 * codepath. Public URLs cost a few hundred ms but stay simple.
 */

const HOST_PREFIX = process.env.RAINBOW_HOST_PREFIX ?? "";
const ZONE = process.env.RAINBOW_ZONE ?? "";

export interface ServiceDescriptor {
    name: string;     // human label
    slug: string;     // URL slug
    healthPath: string; // path appended to the public host for health checks
}

export const SERVICES: ServiceDescriptor[] = [
    { name: "Authentik (auth)", slug: "auth", healthPath: "/-/health/ready/" },
    { name: "Immich (photos)", slug: "photos", healthPath: "/api/server/ping" },
    { name: "Seafile (files)", slug: "files", healthPath: "/api2/ping/" },
    { name: "CryptPad (docs)", slug: "docs", healthPath: "/api/config" },
    { name: "Jellyfin (media)", slug: "media", healthPath: "/health" },
    { name: "Stalwart (mail)", slug: "mail", healthPath: "/" },
];

export function publicHost(slug: string): string {
    return `${HOST_PREFIX}${slug}.${ZONE}`;
}

export function publicUrl(slug: string, path = ""): string {
    return `https://${publicHost(slug)}${path}`;
}
