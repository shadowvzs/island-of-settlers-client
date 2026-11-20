/**
 * The decision boundary for replacing an island session inside one document (ISLAND-LOAD-02).
 * These are pure gates: the handoff coordinator owns saving, preparation and teardown. Keeping the
 * trigger gate and the irreversible-commit fallback here makes them testable without a renderer.
 */

/** Every application transition that may eventually replace a session without a page reload. */
export type IslandHandoffTrigger =
  | "editor-generate"
  | "editor-map-load"
  | "generator-recreate"
  | "graphics-detail"
  | "graphics-appearance"
  | "graphics-reveal-ore"
  | "import-game"
  | "tab-resume"
  | "travel-first-visit"
  | "travel-home"
  | "travel-saved-island";

/**
 * The triggers the in-page boundary owns: return home, saved-island travel and first visits.
 * Imports and editor/generator replacement still use their validated reload paths.
 */
export const IN_PAGE_HANDOFF_TRIGGERS: ReadonlySet<IslandHandoffTrigger> = new Set([
  "editor-generate",
  "editor-map-load",
  "generator-recreate",
  "graphics-detail",
  "graphics-appearance",
  "graphics-reveal-ore",
  "import-game",
  "tab-resume",
  "travel-first-visit",
  "travel-home",
  "travel-saved-island"
]);

/** The cloud authority of the page session during the transition. */
export type HandoffAuthority =
  | "account-changed"
  | "account-current"
  | "account-unknown"
  | "browser";

export type HandoffRefusal =
  | "authority-changed"
  | "authority-unknown"
  | "destination-changed"
  | "not-prepared"
  | "trigger-not-enabled";

export interface HandoffReadiness {
  authority: HandoffAuthority;
  /** The caught-up/staged destination still names the requested island and player context. */
  destinationMatches: boolean;
  /** Decode, validation, catch-up and destination CPU builds finished. */
  prepared: boolean;
  trigger: IslandHandoffTrigger;
}

/**
 * Null: the frozen old session may be replaced. Otherwise the caller must take the named fallback
 * before disposing anything. Checks run identity first: a changed account or destination must never
 * install into the current page session.
 */
export const handoffRefusal = (input: HandoffReadiness): HandoffRefusal | null => {
  if (!IN_PAGE_HANDOFF_TRIGGERS.has(input.trigger)) return "trigger-not-enabled";
  if (input.authority === "account-changed") return "authority-changed";
  if (input.authority === "account-unknown") return "authority-unknown";
  if (!input.prepared) return "not-prepared";
  if (!input.destinationMatches) return "destination-changed";
  return null;
};

export type HandoffFallback = "reload" | "resume-old";

/**
 * A preparation failure leaves the old island intact and can resume it. Authority or destination
 * changes need the normal boot path; an unsupported trigger never entered the in-page path.
 */
export const handoffFallback = (refusal: HandoffRefusal): HandoffFallback =>
  refusal === "not-prepared" ? "resume-old" : "reload";

/**
 * Once the destination save is committed, the departing island is no longer the current truth:
 * a teardown or install failure must reload the committed destination instead of resuming it.
 */
export const handoffFailureFallback = (committed: boolean): HandoffFallback =>
  committed ? "reload" : "resume-old";

/** Travel files the departing island; a new map or a validated import has no departure to keep. */
export const handoffSavesDeparture = (trigger: IslandHandoffTrigger, ending = false) =>
  !ending && (trigger === "travel-first-visit" || trigger === "travel-home" ||
    trigger === "travel-saved-island");

/**
 * A first visit has no destination GameSave yet: its validated visit payload is the reload
 * fallback. Import also keeps its staged payload as the startup fallback, as it does today.
 */
export const handoffWritesStartupPayload = (trigger: IslandHandoffTrigger) =>
  trigger === "import-game" || trigger === "travel-first-visit";
