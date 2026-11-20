import { entriesOfKind, soldierEntries, type SoldierProfile } from "@shared/catalog";

import {
  ARCHER_SHIELD_DAMAGE_MULTIPLIER, HEAVY_ARMOUR_BYPASS_CHANCE, MILITARY_PROFILES
} from "../balance/military";
import { deterministicPow,DMath } from "../math/deterministic-math";
import type { MilitaryStructure } from "./fort-assault-rules";
import type { CommanderLoadout } from "./settlement-commander";

/**
 * World units are map tiles. Mounted units navigate as one rider and mount. The troop keys are the content
 * catalog's `soldier:*` keys (type-level names, guarded 1:1 by content-catalog-codes.test.ts).
 */
export type MilitaryTroopType = "shield" | "heavy" | "archer" | "cavalry";
export type OrdinaryTroopType = Exclude<MilitaryTroopType, "cavalry">;
/**
 * Troops ordinary gameplay may create (HORSE-RETIREMENT-01): the active `soldier:*` entries. Cavalry is a
 * retired entry so historical saves and mounted regression fixtures keep working, but no recruitment, planner,
 * scenario, reward, debug or enemy generator may create it any more.
 */
export const ORDINARY_TROOP_TYPES: readonly OrdinaryTroopType[] = Object.freeze(
  entriesOfKind("soldier").map(entry => entry.key as OrdinaryTroopType));
/** Every troop type, retired cavalry included, in display order. */
export const MILITARY_TROOP_TYPES: readonly MilitaryTroopType[] = Object.freeze(
  soldierEntries().map(entry => entry.key as MilitaryTroopType));
export const isOrdinaryTroopType = (value: unknown): value is OrdinaryTroopType =>
  typeof value === "string" && (ORDINARY_TROOP_TYPES as readonly string[]).includes(value);
export const isMilitaryTroopType = (value: unknown): value is MilitaryTroopType =>
  typeof value === "string" && (MILITARY_TROOP_TYPES as readonly string[]).includes(value);
/** Military buildings accept foot soldiers only, independent of the current mounted-unit hold. */
export const canGarrisonMilitaryType = (type: MilitaryTroopType | undefined) => type !== "cavalry";

export type MilitaryProfile = SoldierProfile;
/** How a soldier fights: a dismounted rider fights as heavy infantry (owner decision 2026-10-13). */
export const militaryWeaponType = (state: Pick<MilitaryCombatant, "commanderLoadout" | "type">): MilitaryTroopType => {
  if (state.commanderLoadout === "bow") return "archer";
  if (state.commanderLoadout === "axe") return "heavy";
  return state.type;
};
export const fightingType = (state: Pick<MilitaryCombatant, "commanderLoadout" | "dismounted" | "type">): MilitaryTroopType => {
  const armed = militaryWeaponType(state);
  return armed === "cavalry" && state.dismounted ? "heavy" : armed;
};
/** Foot soldiers running to the rally banner go this much faster, while more than `RALLY_RUN_REACH` away. */
const RALLY_RUN_SHARE = 1.6;
const RALLY_RUN_REACH = 2;
type PaceState = Pick<MilitaryCombatant, "attackTime" | "destination" | "marchSpeed" | "rallyRunning" | "siege" |
  "target" | "type">;
/** Running to the rally banner: nothing to fight on the way and the banner still some way off. */
const isRallyRunning = (state: PaceState, body: { x: number; z: number }) => {
  const destination = state.destination;
  return Boolean(state.rallyRunning && destination && state.target === undefined && !state.attackTime &&
    state.siege === undefined && DMath.hypot(destination.x - body.x, destination.z - body.z) > RALLY_RUN_REACH);
};
/**
 * Walking pace (tiles per second) of a soldier in the field: a rider off its horse walks at 1.4;
 * foot soldiers run to the rally banner; a group ordered together keeps the group's shared pace.
 */
export const militaryPace = (state: PaceState, body: { mounted?: boolean; x: number; z: number },
  inField: boolean, nationSpeedFactor = 1) => {
  const base = state.type === "cavalry" && !body.mounted ? 1.4 : MILITARY_PROFILES[state.type].speed;
  const own = base * nationSpeedFactor;
  if (inField && isRallyRunning(state, body)) return body.mounted ? own : own * RALLY_RUN_SHARE;
  return state.marchSpeed !== undefined && state.destination && inField ? Math.min(own, state.marchSpeed) : own;
};
/** Hand tool a soldier carries: archers a bow, heavy infantry an axe, everyone else a sword. */
export const militaryTroopTool = (type: MilitaryTroopType | undefined) => {
  if (type === "archer") return "bow";
  return type === "heavy" ? "axe" : "sword";
};
export const militaryHealth = (type: MilitaryTroopType, rank: number) =>
  MILITARY_PROFILES[type].hp * deterministicPow(1.2, rank);

export const militaryDamage = (
  attacker: MilitaryTroopType, rank: number, defender: MilitaryTroopType,
  defenderRank: number, fullContact: boolean, random: () => number
) => {
  const bypass = attacker === "heavy" && random() < HEAVY_ARMOUR_BYPASS_CHANCE;
  const critical = fullContact && random() < rank * .05;
  let damage = MILITARY_PROFILES[attacker].damage * deterministicPow(1.2, rank) * (fullContact ? 1 : .5);
  if (critical) damage *= 1.5;
  if (attacker === "cavalry" && ["shield", "heavy"].includes(defender)) damage *= 1.33;
  if (attacker === "archer" && defender === "shield") damage *= ARCHER_SHIELD_DAMAGE_MULTIPLIER;
  if (!bypass) damage *= 1 - MILITARY_PROFILES[defender].armour[defenderRank]!;
  return { damage, bypass, critical };
};

/**
 * The unit a targetMilitary order chases; `lost` is set while the player cannot see it: where it vanished and
 * for how long (seconds). Past the sight memory the soldiers attack-move to that place instead.
 */
export interface MilitaryChase {
  lost?: { seconds: number; x: number; z: number };
  uid: number;
}

export interface MilitaryCombatant {
  type: MilitaryTroopType;
  /** Catalogue-bound commander weapon; physical cavalry identity/horse navigation stays unchanged. */
  commanderLoadout?: CommanderLoadout;
  faction: number;
  hp: number;
  cooldown: number;
  selected?: boolean;
  /** Persistent identity of the hidden physical horse assigned to this rider. */
  mount?: number;
  /** Move strikes back when hit; attack move fights on the way; retreat ignores everything. */
  order?: "move" | "attackMove" | "retreat";
  /** Last assigned archer at its own doorway (it shoots its bow point-blank at half damage). */
  doorMelee?: boolean;
  /** Shared pace of a group ordered together, until it arrives (tiles per second). */
  marchSpeed?: number;
  /** A banner more than eight tiles away uses travel running until combat or arrival. */
  rallyRunning?: boolean;
  /** A door blow is under way; its damage lands at 75 % of the swing. */
  doorBlow?: boolean;
  /** A pressed field archer with no viable way back shoots its bow point-blank at half damage. */
  closeQuarters?: boolean;
  /** A rider that left its horse waiting to fight at a besieged door as heavy infantry. */
  dismounted?: boolean;
  returnToStorage?: boolean;
  /** Explicit return destination for a colony ship pickup. */
  returnStorageUid?: number;
  destination?: { x: number; z: number };
  target?: number;
  siege?: number;
  routeAge?: number;
  pendingRoute?: { x: number; z: number }[];
  mountOnClear?: boolean;
  attackTime?: number;
  pendingTarget?: number;
  /** A player's targetMilitary lock: the foe these soldiers chase (replaced, never mutated in place). */
  chase?: MilitaryChase;
  /** The player's Shift order queue this soldier marches with (military-order-queue; any other march leaves it). */
  queue?: number;
  /** Manual bow draw, using validated input angles rather than an asserted enemy/hit. */
  pendingAim?: { heading: number; pitch: number };
  towerFall?: { remaining:number;fromY:number;groundY:number };
  fallenTowerArcher?: true;
}
/** Seconds a fallen unit's death effect (fall and smoke) lasts. */
export const MILITARY_DEATH_SECONDS = 2.8;
export interface MilitaryDeathEffect {
  id: number; x: number; y: number; z: number; age: number;
  /** Side of the fallen unit: its smoke takes that player's colour (missing = neutral grey). */
  faction?: number;
}
export interface MilitaryDoor {
  building: number; faction: number; hp: number; maximum: number;
  /** Colony forts: the walls themselves, attacked once every defender is dead (never captured). */
  structure?: MilitaryStructure;
}
