import { FLAX_GROWTH_SECONDS, WHEAT_GROWTH_SECONDS } from "../balance/economy";
import { PLANTATIONS } from "./nation-drinks";
import type { FieldKind, FieldState } from "./settlement-field-cycles";

/** Field states whose progress advances every tick; ripe/stubble/coal wait for a worker. */
export const MATURING_FIELD_STATES: ReadonlySet<FieldState> = new Set(["burning", "fruiting", "growing"]);

export interface FieldGrowthTimer {
  kind: FieldKind;
  progress: number;
  state: FieldState;
}

/** The same crop growth seconds as the live field cycle: charcoal 60, grain 120, flax 60. */
export const fieldGrowthSeconds = ({ kind, state }: Pick<FieldGrowthTimer, "kind" | "state">) => {
  if (kind === "charcoal") return 60;
  if (kind === "grain") return WHEAT_GROWTH_SECONDS;
  if (kind === "flax") return FLAX_GROWTH_SECONDS;
  const { growSeconds, regrowSeconds } = PLANTATIONS[kind];
  return state === "fruiting" ? regrowSeconds ?? growSeconds : growSeconds;
};

/** Crops use the field-growth talent; charcoal piles do not. */
const fieldGrowthRate = (kind: FieldKind, cropRate: number) => kind === "charcoal" ? 1 : cropRate;

/**
 * One field-cycle update, extracted for the event core. Returns null for states that do not mature;
 * otherwise the next progress/state, with the same 1e-9 completion guard and burning transition.
 */
export const advanceFieldProgress = (
  site: FieldGrowthTimer, dt: number, cropRate: number
): FieldGrowthTimer | null => {
  if (!MATURING_FIELD_STATES.has(site.state)) return null;
  const progress = Math.min(1, site.progress + Math.max(0, dt) * fieldGrowthRate(site.kind, cropRate) /
    fieldGrowthSeconds(site));
  if (progress < 1 - 1e-9) return { ...site, progress };
  return { ...site, progress: 1, state: site.state === "burning" ? "uncovering" : "ripe" };
};

export interface FieldGrowthChange {
  site: FieldGrowthTimer;
  tick: number;
}

/**
 * The first fixed tick at which this site changes state (growing/fruiting -> ripe, burning ->
 * uncovering), or null for a state that waits for a worker. The loop preserves the reference float
 * additions; a field rarely needs more than a few thousand steps.
 */
export const advanceFieldUntilChange = (
  site: FieldGrowthTimer, cropRate: number, maxTicks = 100_000, step = .05
): FieldGrowthChange | null => {
  let current = site;
  for (let tick = 1; tick <= maxTicks; tick++) {
    const next = advanceFieldProgress(current, step, cropRate);
    if (!next) return null;
    current = next;
    if (next.state !== site.state) return { site: next, tick };
  }
  return null;
};
