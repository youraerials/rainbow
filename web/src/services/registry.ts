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
    // Containers that make up this service. Defaults to ["rainbow-<name>"].
    // Multi-container services (authentik server+worker, immich server+ML)
    // override this so restart/logs apply to the right set.
    containers?: string[];
    // The "primary" container — the one whose logs are most useful to a human
    // looking at the service. Defaults to containers[0] or "rainbow-<name>".
    primaryContainer?: string;
}

export const SERVICES: ServiceDescriptor[] = [
    {
        name: "authentik",
        slug: "auth",
        displayName: "Authentik",
        description: "Identity & single sign-on",
        healthPath: "/-/health/ready/",
        containers: ["rainbow-authentik-server", "rainbow-authentik-worker"],
        primaryContainer: "rainbow-authentik-server",
    },
    {
        name: "immich",
        slug: "photos",
        displayName: "Immich",
        description: "Photos & video management",
        healthPath: "/api/server/ping",
        containers: ["rainbow-immich", "rainbow-immich-ml"],
        primaryContainer: "rainbow-immich",
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

export function findBySlug(slug: string): ServiceDescriptor | undefined {
    return SERVICES.find((s) => s.slug === slug);
}

export function containersFor(svc: ServiceDescriptor): string[] {
    return svc.containers ?? [`rainbow-${svc.name}`];
}

export function primaryContainerFor(svc: ServiceDescriptor): string {
    return svc.primaryContainer ?? containersFor(svc)[0];
}

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
