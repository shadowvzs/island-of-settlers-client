/** Authored character LOD index: 0 is the full-detail body, 3 the coarsest. */
export type CharacterLodCap = 0 | 1 | 2 | 3;

/**
 * Settings > Graphics > Character detail (C12): an additional cap on top of the Detail level's
 * character policy, switchable without a reload. "auto" follows the Detail level; every other
 * choice can only make characters coarser, never finer than the Detail level loads.
 */
export type CharacterDetailChoice = "auto" | "high" | "medium" | "low" | "minimal";

/** Slider order (cheapest first); "auto" is the first stop. */
export const CHARACTER_DETAIL_CHOICES: readonly CharacterDetailChoice[] = [
  "auto", "high", "medium", "low", "minimal"
];

interface CharacterDetailStep {
  /** Coarser pose cadence on top of the budget controller's bias (frames per pose, 0 = authored). */
  cadence: number;
  /** Coarsest authored level this choice may use (a higher number is coarser). */
  lodMax: CharacterLodCap;
}

const DETAIL_STEPS: Readonly<Record<Exclude<CharacterDetailChoice, "auto">, CharacterDetailStep>> = {
  high: { cadence: 0, lodMax: 0 },
  low: { cadence: 1, lodMax: 2 },
  medium: { cadence: 0, lodMax: 1 },
  minimal: { cadence: 2, lodMax: 3 }
};

/** The Detail level's character gates: the finest levels it loads for civilians and soldiers. */
export interface CharacterPresetLevels {
  lodMax: CharacterLodCap;
  soldierLodMax: CharacterLodCap;
}

/** The effective character cap and cadence floor of one choice on one Detail level. */
export interface ResolvedCharacterDetail extends CharacterPresetLevels {
  cadence: number;
}

const coarser = (preset: CharacterLodCap, selected: CharacterLodCap): CharacterLodCap =>
  (preset >= selected ? preset : selected) as CharacterLodCap;

/**
 * The effective cap of a choice: the player may only step coarser than the Detail level, because
 * the finer authored levels are not loaded on that level (memory strategy, C05).
 */
export const resolveCharacterDetail = (
  choice: CharacterDetailChoice,
  preset: CharacterPresetLevels
): ResolvedCharacterDetail => {
  if (choice === "auto") {
    return { cadence: 0, lodMax: preset.lodMax, soldierLodMax: preset.soldierLodMax };
  }
  const step = DETAIL_STEPS[choice];
  return {
    cadence: step.cadence,
    lodMax: coarser(preset.lodMax, step.lodMax),
    soldierLodMax: coarser(preset.soldierLodMax, step.lodMax)
  };
};

/** Tolerant stored-value parse: an unknown or missing value means "auto". */
export const parseCharacterDetail = (value: string | null): CharacterDetailChoice =>
  (CHARACTER_DETAIL_CHOICES as readonly string[]).includes(value ?? "")
    ? (value as CharacterDetailChoice)
    : "auto";

/**
 * The two live targets of the choice: the renderer's mutable character policy (LOD caps) and the
 * shared cadence object. The budget controller may raise its own bias, never lower this floor.
 */
export interface CharacterDetailTarget {
  cadence: { floor: number };
  policy: CharacterPresetLevels;
}

/** Applies a choice in place, so an already created crowd follows it on its next frame. */
export const applyCharacterDetail = (
  choice: CharacterDetailChoice,
  preset: CharacterPresetLevels,
  target: CharacterDetailTarget
) => {
  const resolved = resolveCharacterDetail(choice, preset);
  target.policy.lodMax = resolved.lodMax;
  target.policy.soldierLodMax = resolved.soldierLodMax;
  target.cadence.floor = resolved.cadence;
};
