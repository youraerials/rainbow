/**
 * Static catalog of Rainbow services. Single source of truth for both the MCP
 * tools and the REST endpoints — anywhere the system needs to ask "which
 * services exist and how do I reach them?", look here.
 *
 * The two name fields are intentional:
 *   - `name`   — the orchestration-level identity ("authentik", "immich", ...).
 *                What the dashboard's data model and rainbow.yaml use.
 *   - `slug`   — the URL slug under the prefix ("auth", "photos", ...).
 *                Drives the public hostname.
 */

const HOST_PREFIX = process.env.RAINBOW_HOST_PREFIX ?? "";
const ZONE = process.env.RAINBOW_ZONE ?? "";

export interface ServiceDescriptor {
    name: string;       // orchestration name (matches container suffix)
    slug: string;       // URL slug
    displayName: string;
    description: string;
    healthPath: string; // path appended to publicUrl() for liveness checks
}

export const SERVICES: ServiceDescriptor[] = [
    {
        name: "authentik",
        slug: "auth",
        displayName: "Authentik",
        description: "Identity & single sign-on",
        healthPath: "/-/health/ready/",
    },
    {
        name: "immich",
        slug: "photos",
        displayName: "Immich",
        description: "Photos & video management",
        healthPath: "/api/server/ping",
    },
    {
        name: "stalwart",
        slug: "mail",
        displayName: "Stalwart",
        description: "Email, calendar, contacts",
        healthPath: "/login",
    },
    {
        name: "seafile",
        slug: "files",
        displayName: "Seafile",
        description: "File sharing & sync",
        healthPath: "/api2/ping/",
    },
    {
        name: "cryptpad",
        slug: "docs",
        displayName: "CryptPad",
        description: "Collaborative documents",
        healthPath: "/api/config",
    },
    {
        name: "jellyfin",
        slug: "media",
        displayName: "Jellyfin",
        description: "Media server",
        healthPath: "/health",
    },
];

export function publicHost(slug: string): string {
    return `${HOST_PREFIX}${slug}.${ZONE}`;
}

export function publicUrl(slug: string, path = ""): string {
    return `https://${publicHost(slug)}${path}`;
}

export function webHost(): string {
    if (HOST_PREFIX) {
        return `${HOST_PREFIX.replace(/-$/, "")}.${ZONE}`;
    }
    return ZONE;
}
