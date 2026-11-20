import {
  MORALE_AURA, MORALE_BASE, MORALE_BROKEN, MORALE_CALM_TICKS, MORALE_DEATH, MORALE_DEATH_CAP, MORALE_ENCIRCLE_HEAVY,
  MORALE_ENCIRCLE_HEAVY_SECTORS, MORALE_ENCIRCLE_LIGHT, MORALE_ENCIRCLE_LIGHT_SECTORS, MORALE_ENTER, MORALE_FALL,
  MORALE_FORT, MORALE_LEAVE, MORALE_OUTNUMBER_HEAVY, MORALE_OUTNUMBER_HEAVY_RATIO, MORALE_OUTNUMBER_LIGHT,
  MORALE_OUTNUMBER_LIGHT_RATIO, MORALE_PER_RANK, MORALE_RISE, MORALE_ROUTED_NEIGHBOUR, MORALE_STEADY,
  MORALE_WAVERING, MORALE_WOUNDED, MORALE_WOUNDED_PERCENT, type MoraleState
} from "../../balance/morale";

/**
 * Morale rules (A14 plan §4): pure integer arithmetic, no randomness. `military-morale-update.ts` gathers the
 * inputs round each field soldier on its update slot and applies the effects of a state change.
 */

/** What a soldier's surroundings say at one update (counts and integer percentages). */
export interface MoraleInputs {
  rank: number;
  /** A friendly commander hero's aura covers it; an own manned military building is near. */
  aura: boolean;
  fort: boolean;
  /** Friendly falls near it in the last 10 s, and broken comrades near it. */
  deaths: number;
  routedNeighbours: number;
  /** Sectors (of 8) round it holding a known enemy within the encirclement radius. */
  sectors: number;
  /** Known enemy strength over own strength near it, ×100 (floored; 0 without enemies). */
  ratioPercent: number;
  /** Its own health share ×100 (floored). */
  healthPercent: number;
}

/** The morale a fresh soldier starts with: its base before any battle input. */
export const baseMorale = (rank: number) => Math.min(100, MORALE_BASE + MORALE_PER_RANK * rank);

const encirclementOf = (sectors: number) => {
  if (sectors >= MORALE_ENCIRCLE_HEAVY_SECTORS) return MORALE_ENCIRCLE_HEAVY;
  return sectors >= MORALE_ENCIRCLE_LIGHT_SECTORS ? MORALE_ENCIRCLE_LIGHT : 0;
};

const outnumberedOf = (ratioPercent: number) => {
  if (ratioPercent >= MORALE_OUTNUMBER_HEAVY_RATIO) return MORALE_OUTNUMBER_HEAVY;
  return ratioPercent >= MORALE_OUTNUMBER_LIGHT_RATIO ? MORALE_OUTNUMBER_LIGHT : 0;
};

/** The morale a soldier moves towards (plan §4.1 `M*`), clamped to 0-100. */
export const targetMorale = (inputs: Readonly<MoraleInputs>) => {
  const losses = Math.min(MORALE_DEATH_CAP,
    MORALE_DEATH * inputs.deaths + MORALE_ROUTED_NEIGHBOUR * inputs.routedNeighbours);
  const value = MORALE_BASE + MORALE_PER_RANK * inputs.rank
    + (inputs.aura ? MORALE_AURA : 0) + (inputs.fort ? MORALE_FORT : 0)
    - losses - encirclementOf(inputs.sectors) - outnumberedOf(inputs.ratioPercent)
    - (inputs.healthPercent < MORALE_WOUNDED_PERCENT ? MORALE_WOUNDED : 0);
  return Math.max(0, Math.min(100, value));
};

/** One update's step towards the target: down fast, up slowly. */
export const stepMorale = (value: number, target: number) =>
  value > target ? Math.max(target, value - MORALE_FALL) : Math.min(target, value + MORALE_RISE);

/**
 * The state after an update (hysteresis +10). Falling is immediate; a wavering or broken soldier recovers
 * (one state per update) only after `MORALE_CALM_TICKS` without a known enemy near (the rally rule).
 */
export const nextMoraleState = (state: MoraleState, value: number, calm: number): MoraleState => {
  let next = state;
  while (next < MORALE_BROKEN && value < MORALE_ENTER[next + 1]!) next++;
  if (next !== state) return next as MoraleState;
  if (next === MORALE_STEADY || value < MORALE_LEAVE[next]!) return next;
  if (next >= MORALE_WAVERING && calm < MORALE_CALM_TICKS) return next;
  return (next - 1) as MoraleState;
};
