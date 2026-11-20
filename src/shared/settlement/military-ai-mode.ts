/**
 * Military AI mode (owner decision 2026-10-19, FUTURE-07 cleanup): flow-field movement with
 * group destination places (no separate formations mode) for both sides, plus the influence-map
 * commander for the computer side.
 *
 * Earlier builds exposed five debug modes. The losing modes were removed from selection and live
 * switching; their identifiers remain only as save aliases, normalized to the shipped mode when an
 * old save loads (docs/archive/dated/military-motion-2026-10-13.md section 10).
 */
export type MilitaryAiMode = "flowCommander";

/** Mode ids written by builds before FUTURE-07. Load-only: never selectable, normalized on load. */
export type LegacyMilitaryAiMode = "current" | "flowFields" | "formations" | "smartCommander";

/** A mode id that a format-1 save may contain. */
export type SavedMilitaryAiMode = MilitaryAiMode | LegacyMilitaryAiMode;

/**
 * The only supported mode (owner decision 2026-10-19): flow-field movement with group destination
 * places (no separate formations mode) for both sides and the smart commander for the computer side.
 */
export const SHIPPED_MILITARY_AI_MODE: MilitaryAiMode = "flowCommander";

export const SHIPPED_MILITARY_AI_MODE_LABEL = "Flow fields + commander (shipped)";

/** The selectable catalog (development tools only); one shipped mode remains. */
export const MILITARY_AI_MODES: readonly { label: string; value: MilitaryAiMode }[] = [
  { label: SHIPPED_MILITARY_AI_MODE_LABEL, value: SHIPPED_MILITARY_AI_MODE }
];

const LEGACY_MILITARY_AI_MODES: readonly LegacyMilitaryAiMode[] = [
  "current",
  "flowFields",
  "formations",
  "smartCommander"
];

/** A live selection: only the shipped mode. Removed modes are rejected. */
export const isMilitaryAiMode = (value: unknown): value is MilitaryAiMode =>
  value === SHIPPED_MILITARY_AI_MODE;

/** A mode id a save may contain: the shipped mode or one of the removed legacy modes. */
const isSavedMilitaryAiMode = (value: unknown): value is SavedMilitaryAiMode =>
  isMilitaryAiMode(value) ||
  (typeof value === "string" && LEGACY_MILITARY_AI_MODES.includes(value as LegacyMilitaryAiMode));

/**
 * The live mode for a saved id. Old saves keep loading: every removed mode normalizes to the
 * shipped mode instead of rejecting an otherwise valid format-1 save.
 */
export const normalizeMilitaryAiMode = (value: unknown): MilitaryAiMode | undefined =>
  isSavedMilitaryAiMode(value) ? SHIPPED_MILITARY_AI_MODE : undefined;
