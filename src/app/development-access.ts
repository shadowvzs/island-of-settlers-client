/** Who may open Development tools and run its state-changing debug commands. */
export interface DevelopmentAccessOptions {
  /** A signed-in online account: its save belongs to the server. */
  online: boolean;
  /** The signed-in account's role claim (null/undefined for guests). */
  role?: string | null;
  /** A development build (`import.meta.env.DEV`): guests keep the tools for local work. */
  devBuild: boolean;
}

export type DevelopmentAccessReason =
  | "admin"
  | "guest-dev-build"
  | "guest-production"
  | "player-entry"
  | "signed-in-player";

export interface DevelopmentAccess {
  allowed: boolean;
  reason: DevelopmentAccessReason;
}

/**
 * Owner decision 2026-10-15: Development tools are for administrators. A guest may use them only in a
 * development build; production guests and signed-in players/moderators may not. The admin page resolves
 * this before downloading its module chunk; the server checks the signed role claim again for command
 * logs and privileged APIs, so this is the UI/early-refusal half of the policy, not the authority.
 */
export const resolveDevelopmentAccess = ({
  devBuild, online, role
}: DevelopmentAccessOptions): DevelopmentAccess => {
  if (online) return role === "admin" ? { allowed: true, reason: "admin" } :
    { allowed: false, reason: "signed-in-player" };
  return devBuild ? { allowed: true, reason: "guest-dev-build" } : { allowed: false, reason: "guest-production" };
};

/** A signed-in account with the administrator role claim; a development build's guest is not one. */
export const isAdministrator = (access: DevelopmentAccess) => access.reason === "admin";

/** Shown when code reaches a debug action that the current account may not use. */
export const DEVELOPMENT_ONLY_MESSAGE = "Development tools are available only to administrators.";
