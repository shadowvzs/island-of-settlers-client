import type { WorkerNation } from "../../render-common/workers/worker-unit";

/**
 * Canonical national advantages (NATION-07). One economy and one military effect per nation, used
 * by the simulation, balance estimates and the shared hover tooltip. Values are deliberately small
 * and additive; the owner-approved Chinese/Nubian/Indigenous/Roman values are first, the remaining
 * four use the same bounded convention until a playtest revision.
 */
export type NationTroop = "archer" | "heavy" | "shield";

export type NationEconomyScope =
  | "construction" | "drink" | "farms" | "hunter" | "mines" | "woodcutters";

export type NationEconomyBonus =
  | { constructionShare: number; kind: "construction"; scope: "construction" }
  | { kind: "production"; scope: Exclude<NationEconomyScope, "construction">; share: number;
    types: readonly number[] };

export type NationMilitaryBonus =
  | { chance: number; kind: "archer-double" }
  | { kind: "archer-damage"; share: number }
  | { kind: "damage"; share: number; troops: readonly NationTroop[] }
  | { kind: "health"; share: number; troops: readonly NationTroop[] }
  | { kind: "movement"; share: number }
  | { kind: "range"; share: number };

export interface NationBonus {
  economy: NationEconomyBonus;
  military: NationMilitaryBonus;
}

/** Type ids follow the shared catalog; never renumber them. */
const WOODCUTTERS = [17, 42, 46, 50, 54] as const;
const FARMS = [37, 60] as const;
const DRINK_CHAIN = [5, 6] as const;
const MINES = [10, 11, 12, 13, 19, 43, 47, 51, 55] as const;
const HUNTERS = [18, 22] as const;

export const NATION_BONUSES: Readonly<Record<WorkerNation, NationBonus>> = Object.freeze({
  roman: Object.freeze({
    economy: Object.freeze({ constructionShare: .05, kind: "construction", scope: "construction" }),
    military: Object.freeze({ kind: "health", share: .05, troops: ["archer", "heavy", "shield"] as const }),
  }),
  viking: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "woodcutters", share: .05, types: WOODCUTTERS }),
    military: Object.freeze({ kind: "damage", share: .10, troops: ["heavy"] as const }),
  }),
  japanese: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "farms", share: .05, types: [...FARMS, ...DRINK_CHAIN] }),
    military: Object.freeze({ kind: "archer-damage", share: .05 }),
  }),
  nubian: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "mines", share: .05, types: MINES }),
    military: Object.freeze({ kind: "range", share: .10 }),
  }),
  chinese: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "drink", share: .05, types: DRINK_CHAIN }),
    military: Object.freeze({ chance: .05, kind: "archer-double" }),
  }),
  persian: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "drink", share: .05, types: DRINK_CHAIN }),
    military: Object.freeze({ kind: "health", share: .05, troops: ["heavy", "shield"] as const }),
  }),
  maya: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "farms", share: .05, types: [...FARMS, ...DRINK_CHAIN] }),
    military: Object.freeze({ kind: "archer-damage", share: .10 }),
  }),
  indigenous: Object.freeze({
    economy: Object.freeze({ kind: "production", scope: "hunter", share: .05,
      types: [...HUNTERS, ...DRINK_CHAIN] }),
    military: Object.freeze({ kind: "movement", share: .15 }),
  }),
});

export const nationBonus = (nation: WorkerNation | undefined) =>
  NATION_BONUSES[nation ?? "roman"] ?? NATION_BONUSES.roman;

/** Additive production-speed share of this building type (0 when the nation has no matching bonus). */
export const nationProductionShare = (nation: WorkerNation | undefined, typeId: number) => {
  const economy = nationBonus(nation).economy;
  return economy.kind === "production" && economy.types.includes(typeId) ? economy.share : 0;
};

/** Additive builder work-rate share. */
export const nationConstructionShare = (nation: WorkerNation | undefined) => {
  const economy = nationBonus(nation).economy;
  return economy.kind === "construction" ? economy.constructionShare : 0;
};

/** Fraction of a player soldier's received damage removed by national health discipline. */
export const nationSoldierHealthShare = (nation: WorkerNation | undefined, troop: NationTroop) => {
  const military = nationBonus(nation).military;
  return military.kind === "health" && military.troops.includes(troop) ? military.share : 0;
};

/** Additive damage share for a player troop. */
export const nationDamageShare = (nation: WorkerNation | undefined, troop: NationTroop) => {
  const military = nationBonus(nation).military;
  if (military.kind === "damage" && military.troops.includes(troop)) return military.share;
  if (military.kind === "archer-damage" && troop === "archer") return military.share;
  return 0;
};

/** National chance that a player archer shot deals exactly double damage instead of a rank critical. */
export const nationArcherDoubleChance = (nation: WorkerNation | undefined) => {
  const military = nationBonus(nation).military;
  return military.kind === "archer-double" ? military.chance : 0;
};

/** Military walking-speed factor (field movement and marching, never civilian carriers). */
export const nationMilitarySpeedFactor = (nation: WorkerNation | undefined) => {
  const military = nationBonus(nation).military;
  return military.kind === "movement" ? 1 + military.share : 1;
};

/** Bow-range factor of this nation's archers. Tower height uses the better factor, never the product. */
export const nationArcherRangeFactor = (nation: WorkerNation | undefined) => {
  const military = nationBonus(nation).military;
  return military.kind === "range" ? 1 + military.share : 1;
};

/** One player attack's national result: the Chinese double replaces a rank critical, never stacks. */
export const applyNationalAttack = (
  damage: number, critical: boolean, nation: WorkerNation | undefined, troop: NationTroop,
  faction: number, doubleRoll: number
) => {
  if (faction !== 0) return { critical, damage };
  let next = damage * (1 + nationDamageShare(nation, troop));
  if (troop === "archer" && doubleRoll < nationArcherDoubleChance(nation)) {
    if (critical) next /= 1.5;
    return { critical: true, damage: next * 2 };
  }
  return { critical, damage: next };
};

/** One player defence's national mitigation; a non-player defender is unchanged. */
export const applyNationalDefence = (
  damage: number, nation: WorkerNation | undefined, troop: NationTroop, faction: number
) => faction === 0 ? damage / (1 + nationSoldierHealthShare(nation, troop)) : damage;
