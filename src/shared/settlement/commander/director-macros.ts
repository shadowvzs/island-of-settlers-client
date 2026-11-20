import {
  MACRO_COMMITMENT, MACRO_SCORES, RAID_MIN_TIER, RAID_PARTY_MAX, REGROUP_MORALE, REGROUP_SPREAD, WITHDRAW_BROKEN,
  WITHDRAW_STRENGTH
} from "../../balance/commander-director";
import { DIRECTOR_MACROS, type DirectorMacro, type ForceKind } from "./director-types";

/** A known target as the macro scores see it: its tier and own strength over its uncertain known defence. */
export interface MacroTarget { ratio: number; tier: number }

/** Everything a macro choice reads (A14 plan §5.1 preconditions; knowledge only). */
export interface MacroInputs {
  kind: ForceKind;
  current: DirectorMacro;
  /** Members able to fight (not broken) and the integer strengths (×100). */
  members: number;
  strength: number;
  start: number;
  brokenShare: number;
  spread: number;
  moraleMean: number;
  /** A known enemy near the force's centre (no regroup in contact). */
  contact: boolean;
  /** A known enemy near the force's home (defend). */
  threat: boolean;
  target?: MacroTarget;
  /** A wave's destination exists. */
  goal: boolean;
  /** A scout goal exists. */
  scoutable: boolean;
  /** The faction's attack and raid ratios (its commander profile). */
  attackRatio: number;
  raidRatio: number;
}

export type MacroScores = Record<DirectorMacro, number>;

const offensive = (inputs: MacroInputs) => inputs.target !== undefined || inputs.goal;

const withdrawScore = (inputs: MacroInputs) => {
  if (inputs.kind === "wave") return -Infinity;
  const weak = inputs.strength < inputs.start * WITHDRAW_STRENGTH;
  return weak || inputs.brokenShare >= WITHDRAW_BROKEN ? MACRO_SCORES.withdraw : -Infinity;
};

/**
 * Regroup interrupts an offensive under way (a fresh force musters at launch anyway) when it spread or its
 * morale sank; a running regroup lasts until its method finds the force gathered (hysteresis).
 */
const regroupScore = (inputs: MacroInputs) => {
  if (inputs.kind === "wave" || inputs.contact || inputs.members < 2) return -Infinity;
  if (inputs.current === "regroup") return MACRO_SCORES.regroup;
  if (inputs.current !== "strike" && inputs.current !== "raid") return -Infinity;
  return inputs.spread > REGROUP_SPREAD || inputs.moraleMean < REGROUP_MORALE ? MACRO_SCORES.regroup : -Infinity;
};

const raidScore = ({ members, raidRatio, target }: MacroInputs) => {
  if (!target || target.tier < RAID_MIN_TIER || members > RAID_PARTY_MAX) return -Infinity;
  return target.ratio >= raidRatio ? MACRO_SCORES.raid : -Infinity;
};

const strikeScore = (inputs: MacroInputs) => {
  if (!offensive(inputs)) return -Infinity;
  if (inputs.goal) return MACRO_SCORES.strikeReady;
  return inputs.target!.ratio >= inputs.attackRatio ? MACRO_SCORES.strikeReady : MACRO_SCORES.strike;
};

const scoutScore = (inputs: MacroInputs) =>
  !offensive(inputs) && inputs.scoutable && !inputs.threat ? MACRO_SCORES.scout : -Infinity;

/**
 * Scores the ≤ 7 macros of one force (plan §5.1): a macro whose precondition fails scores −Infinity; hold is
 * always possible. A wave never withdraws, defends or regroups (its script owns the outcome).
 */
export const scoreMacros = (inputs: MacroInputs): MacroScores => ({
  defend: inputs.threat && inputs.kind !== "wave" ? MACRO_SCORES.defend : -Infinity,
  hold: MACRO_SCORES.hold,
  raid: raidScore(inputs),
  regroup: regroupScore(inputs),
  scout: scoutScore(inputs),
  strike: strikeScore(inputs),
  withdraw: withdrawScore(inputs)
});

/**
 * The scores of a force that carries out an intent (A14-4c, plan §5.4): of the macros a force picks freely
 * only the `wanted` one stays possible (when its precondition holds; hold otherwise). Withdraw and regroup
 * keep their own scores: the director owns every field decision, so a beaten force still pulls back.
 */
export const orderScores = (scores: MacroScores, wanted: DirectorMacro, inputs: MacroInputs): MacroScores => ({
  defend: wanted === "defend" && inputs.threat ? MACRO_SCORES.defend : -Infinity,
  hold: MACRO_SCORES.hold,
  raid: wanted === "raid" && offensive(inputs) ? MACRO_SCORES.raid : -Infinity,
  regroup: scores.regroup,
  scout: wanted === "scout" && inputs.scoutable ? MACRO_SCORES.scout : -Infinity,
  strike: wanted === "strike" ? scores.strike : -Infinity,
  withdraw: wanted === "withdraw" ? MACRO_SCORES.withdraw : scores.withdraw
});

/**
 * The best macro in `DIRECTOR_MACROS` order (ties: the earlier one); the current macro is kept unless the best
 * beats it by `MACRO_COMMITMENT`, or when its precondition no longer holds.
 */
export const chooseMacro = (scores: MacroScores, current: DirectorMacro, committed = true): DirectorMacro => {
  let best: DirectorMacro = "hold";
  for (const macro of DIRECTOR_MACROS) if (scores[macro] > scores[best]) best = macro;
  const kept = scores[current];
  if (!committed || kept === -Infinity || best === current) return best;
  return scores[best] > kept + MACRO_COMMITMENT ? best : current;
};
