/**
 * Wizard state mirrors what /api/setup/state returns from the server.
 * The server is the source of truth — this file just types the shape
 * for the client and lists the canonical step order.
 */

export type DomainMode = "claim" | "byo";

export interface SetupState {
  step: number;
  preflight?: {
    passedAt: string;
    macosVersion?: string;
    appleSilicon?: boolean;
    controlDaemonUp?: boolean;
  };
  domain?: {
    mode: DomainMode;
    prefix?: string;
    zone: string;
    apex: string;
  };
  tunnel?: {
    id: string;
    name: string;
    credentialsWrittenTo: string;
  };
  // password is held only until provision.ts mints it into Keychain
  // as `rainbow-admin-password`; provision then patches it back out
  // of state so it doesn't sit in setup-state.json after the wizard.
  admin?: { email: string; name: string; password?: string };
  services?: Record<string, boolean>;
  storage?: Record<string, string>;
  completedAt?: string;
}

export const STEPS = [
  { key: "welcome", title: "Welcome" },
  { key: "preflight", title: "Preflight" },
  { key: "domain", title: "Choose your name" },
  { key: "admin", title: "First user" },
  { key: "services", title: "Services" },
  { key: "storage", title: "Storage" },
  { key: "review", title: "Review" },
  { key: "provision", title: "Installing" },
  { key: "done", title: "Welcome home" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export const DEFAULT_SERVICES: Record<string, { label: string; description: string; default: boolean }> = {
  photos: { label: "Photos", description: "Immich — photos, video, ML search, albums.", default: true },
  mail: { label: "Email", description: "Stalwart — IMAP, JMAP, calendar, contacts.", default: true },
  webmail: { label: "Webmail", description: "Snappymail — browser inbox.", default: true },
  files: { label: "Files", description: "Seafile — sync + share with version history.", default: true },
  docs: { label: "Documents", description: "CryptPad — collaborative encrypted documents.", default: true },
  media: { label: "Media", description: "Jellyfin — movies, shows, music, books.", default: true },
};
