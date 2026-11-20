import { DOOR_ARCHER_DAMAGE, MILITARY_PROFILES } from "../balance/military";
import type { MoraleState } from "../balance/morale";
import {
  emitUnitDamaged, emitUnitKilled, type ScriptDamageSource, unitSource
} from "../script-world/script-unit-events";
import type { FactionKnowledge } from "./faction-knowledge";
import type { createMilitaryArchery } from "./military-archery";
import { catapultMaximumHp } from "./military-catapult-impact";
import {
  fightingType, type MilitaryCombatant, militaryDamage, type MilitaryDeathEffect, type MilitaryDoor
} from "./military-combat-rules";
import type { createArrivingBlocks, createMarchSettling } from "./military-formation";
import type { createMilitaryMarchRoutes } from "./military-long-routes";
import type { createMilitaryMelee } from "./military-melee";
import type { createMilitaryMountPoints } from "./military-mount-points";
import type { MilitaryMovement } from "./military-movement";
import type { MilitarySpatialGrid } from "./military-spatial-grid";
import type { createMilitarySteering } from "./military-steering";
import type { createMilitaryStuckRecovery } from "./military-stuck";
import { type ArcherRetreat, HIT_ALERT_RADIUS, type MilitaryOrder } from "./military-targeting";
import {
  applyNationalAttack, applyNationalDefence, nationArcherDoubleChance, type NationTroop
} from "./nation-bonuses";
import type { SettlementSoldier } from "./settlement-military";
import type { createSettlementSieges } from "./settlement-siege";
import { soldierBlowTalentFactor } from "./settlement-talents";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";

/** Large group routes are planned over simulation steps, with their assigned formation places retained. */
export interface PendingMarch {
  uid: number; goal: SettlementPoint; destination: SettlementPoint; faction: number;
  mode: MilitaryOrder; gathering: boolean;
}

/** Per-soldier battle memory (saved with the field state). */
export interface FieldMemory {
  /** Guard post or camp (guard, camp), or where a march diverted to fight (march, siege). */
  anchor?: SettlementPoint;
  /** Who struck this soldier last, and whether it was struck since its last decision. */
  lastAttacker?: number;
  struck: boolean;
  /** A target followed past the leash; not picked again until the next order. */
  ignored?: number;
  seekTime: number;
  /** Rallied: the attack move ends as a guard at the rally point instead of seeking. */
  guardOnArrival?: boolean;
  /** An archer's current threat episode (backing away, its budget). */
  retreat?: ArcherRetreat;
  /** A14-2: the enemy its commander's squad focuses on, and the squad it was in (computer soldiers only). */
  focus?: number;
  squad?: number;
  /** A14-2: until this tick a striking flank soldier ignores being outnumbered in its morale (the strike's grace). */
  strikeGrace?: number;
  /** A14-2 morale 0-100, its state (absent: steady) and the ticks without a known enemy near (rally). */
  morale?: number;
  moraleState?: MoraleState;
  calm?: number;
  /** The game tick of the player's last explicit order to this soldier (morale: the order wins a while). */
  orderedTick?: number;
  /**
   * A14-3 rout: the rally point a broken soldier runs to along its covered route (absent once reached, or when
   * another order replaced the rout), and its morale updates in a row with the way out blocked (cornered at 2).
   */
  rally?: SettlementPoint;
  blocked?: number;
}
export interface FieldTarget { body: SettlementActor; soldier: SettlementSoldier }

/**
 * A new order starts a fresh field memory, but morale (A14-2), the commander's squad and the player's order
 * tick belong to the soldier, not to the order: they carry over. Returns the fresh memory, or undefined when nothing carries.
 */
export const freshFieldMemory = (memory: FieldMemory | undefined): FieldMemory | undefined => {
  if (!memory || (memory.morale === undefined && memory.orderedTick === undefined && memory.squad === undefined))
    return undefined;
  const fresh: FieldMemory = { seekTime: 0, struck: false };
  if (memory.squad !== undefined) fresh.squad = memory.squad;
  if (memory.strikeGrace !== undefined) fresh.strikeGrace = memory.strikeGrace;
  if (memory.morale !== undefined) { fresh.morale = memory.morale; fresh.calm = memory.calm; }
  if (memory.moraleState !== undefined) fresh.moraleState = memory.moraleState;
  if (memory.orderedTick !== undefined) fresh.orderedTick = memory.orderedTick;
  return fresh;
};
/** Where a rider last checked for a mounted way on (and towards which goal). */
export interface MountCheck { goal?: SettlementPoint; point: SettlementPoint }

/**
 * `pointBlank`: an archer shooting its bow at half damage (last door defender, cornered in the field).
 * `archerPost`: an archer shooting from a tower post, a window or a door (the tower archer talent).
 */
export type CombatHit = (attacker: SettlementSoldier, defender: SettlementSoldier, full: boolean,
  pointBlank?: boolean, multiplier?: number, archerPost?: boolean, instantKill?: boolean, fixedDamage?: number,
  scriptSource?: ScriptDamageSource) => void;

/** The shared state and services of one settlement's combat, wired once at setup. */
export interface CombatCore {
  actorById: (id: number) => SettlementActor | undefined;
  archery: ReturnType<typeof createMilitaryArchery>;
  arriving: ReturnType<typeof createArrivingBlocks>;
  context: SettlementContext;
  doors: Map<number, MilitaryDoor>;
  factionOf: (id: number) => number | undefined;
  grid: MilitarySpatialGrid<SettlementActor>;
  hit: CombatHit;
  /** A soldier standing in the open field (a valid melee target and grid member). */
  inField: (body: SettlementActor | undefined) => boolean;
  initialize: (soldier: SettlementSoldier) => MilitaryCombatant;
  isEnemyOf: (faction: number) => (body: SettlementActor) => boolean;
  /** An enemy soldier `faction` knows now (A13 phase 3: seen by its layer or under its hit alert). */
  isKnownEnemyOf: (faction: number) => (body: SettlementActor) => boolean;
  knowledge: FactionKnowledge;
  marches: ReturnType<typeof createMilitaryMarchRoutes>;
  melee: ReturnType<typeof createMilitaryMelee>;
  memories: Map<number, FieldMemory>;
  memoryOf: (id: number) => FieldMemory;
  mountChecks: Map<number, MountCheck>;
  mounts: ReturnType<typeof createMilitaryMountPoints>;
  movement: MilitaryMovement;
  pendingMarches: Map<number, PendingMarch>;
  random: AuditedRandom;
  settling: ReturnType<typeof createMarchSettling>;
  sieges: ReturnType<typeof createSettlementSieges>;
  soldiers: Map<number, SettlementSoldier>;
  steering: ReturnType<typeof createMilitarySteering>;
  stuck: ReturnType<typeof createMilitaryStuckRecovery>;
}

/** A pressed archer's point-blank bow shot reaches an enemy this close (its minimum range and a margin). */
export const POINT_BLANK_REACH = MILITARY_PROFILES.archer.minimumRange + .2;

export const profileOf = (state: MilitaryCombatant) => MILITARY_PROFILES[fightingType(state)];

interface CasualtyDeps {
  defenceFactor?: (attacker: SettlementActor, defender: SettlementActor) => number;
  actorById: CombatCore["actorById"];
  context: SettlementContext;
  deaths: MilitaryDeathEffect[];
  grid: MilitarySpatialGrid<SettlementActor>;
  inField: CombatCore["inField"];
  initialize: CombatCore["initialize"];
  knowledge: FactionKnowledge;
  memoryOf: CombatCore["memoryOf"];
  random: AuditedRandom;
  /** A14-2 morale: a soldier of `faction` fell at (x, z). */
  recordFall?: (faction: number, x: number, z: number) => void;
  /** Takes a soldier (and its horse) out of the world without a fall. */
  removeSoldier: (soldier: SettlementSoldier, actor: SettlementActor) => void;
  soldiers: Map<number, SettlementSoldier>;
}

/** Blows landing on soldiers (`hit`) and the map script's outright kill (`fell`, TRG5a: no attacker, no blow). */
export interface CombatCasualties {
  fell: (soldier: SettlementSoldier) => void;
  hit: CombatHit;
}

/** Blows landing on soldiers: damage, deaths and the struck side's response. */
export const createCombatCasualties = ({
  actorById, context, deaths, defenceFactor, grid, inField, initialize, knowledge, memoryOf, random, recordFall,
  removeSoldier, soldiers
}: CasualtyDeps): CombatCasualties => {
  /** The map script's view of a blow (TRG3a): no work at all on islands without a listening script. */
  const reportBlow = (attacker: SettlementSoldier, defender: SettlementSoldier, before: number,
    scriptSource: ScriptDamageSource | undefined) => {
    const script = context.script;
    if (!script || (!script.isSubscribed("actorDamaged") && !script.isSubscribed("actorKilled"))) return;
    const source = scriptSource ?? unitSource(actorById(attacker.actor));
    const after = defender.combat?.hp ?? 0;
    emitUnitDamaged(context, actorById(defender.actor), source,
      { after, before, maximum: catapultMaximumHp(context, defender) });
    return source;
  };
  const kill = (soldier: SettlementSoldier, source?: ScriptDamageSource) => {
    const actor = actorById(soldier.actor);
    if (!actor) return;
    if (context.script) emitUnitKilled(context, actor, source);
    context.expeditionCombat?.death(soldier.combat?.type ?? "shield", soldier.combat?.faction ?? 0);
    deaths.push({ age: 0, faction: soldier.combat?.faction, id: actor.uid, x: actor.x, y: actor.y, z: actor.z });
    recordFall?.(soldier.combat?.faction ?? 0, actor.x, actor.z);
    // Equipment and the deceased population are never refunded or returned to storage.
    removeSoldier(soldier, actor);
  };
  /** Idle comrades near a struck soldier turn on its attacker (both sides; no new order or formation). */
  const alertComrades = (victim: SettlementActor, faction: number, attacker: SettlementActor) => {
    grid.forEachWithin(victim.x, victim.z, HIT_ALERT_RADIUS, other => {
      const state = soldiers.get(other.uid)?.combat;
      return other !== victim && state?.faction === faction && state.target === undefined &&
        state.order !== "retreat" && state.order !== "move" && inField(other);
    }, other => {
      soldiers.get(other.uid)!.combat!.target = attacker.uid;
      memoryOf(other.uid).struck = true;
    });
  };
  /**
   * Hit response: the victim remembers its attacker and re-targets at once; idle comrades join in. The
   * attacker becomes known to the victim's faction for a while (A13 hit alert), even when nobody sees it.
   */
  const recordHit = (attacker: SettlementSoldier, defender: SettlementSoldier) => {
    const memory = memoryOf(defender.actor), victim = actorById(defender.actor), enemy = actorById(attacker.actor);
    memory.lastAttacker = attacker.actor; memory.struck = true;
    knowledge.alert(defender.combat!.faction, attacker.actor);
    if (victim && inField(enemy) && inField(victim)) alertComrades(victim, defender.combat!.faction, enemy!);
  };
  /** A death that skips the commander's incapacitation (instant kills, the map script's `kill`). */
  const fall = (defender: SettlementSoldier, source: ScriptDamageSource | undefined) => {
    if (defender.commanderId) {
      context.options.commanderOwner?.release?.(defender.commanderId);
      context.commander?.recordDeath(defender);
    }
    kill(defender, source);
  };
  /** The map script makes a unit drop dead where it stands (counts as killed, without a killer). */
  const fell = (defender: SettlementSoldier) => {
    initialize(defender).hp = 0;
    fall(defender, undefined);
  };
  /** Story protection (TRG5a `setInvulnerable`): blows on the unit change nothing. */
  const shielded = (defender: SettlementSoldier) => context.script?.isInvulnerable(defender.actor) === true;
  const hit: CombatHit = (attacker, defender, full, pointBlank = false, multiplier = 1, archerPost = false,
    instantKill = false, fixedDamage?: number, scriptSource?: ScriptDamageSource) => {
    if (context.script && shielded(defender)) return;
    if (instantKill) {
      const defence = initialize(defender), before = defence.hp;
      defence.hp = 0;
      fall(defender, reportBlow(attacker, defender, before, scriptSource));
      return;
    }
    if (fixedDamage !== undefined) {
      const defence = initialize(defender), before = defence.hp;
      defence.hp = Math.max(0, defence.hp - fixedDamage);
      const source = reportBlow(attacker, defender, before, scriptSource);
      if (!defence.hp && defender.commanderId && context.commander?.incapacitate(defender)) return;
      if (!defence.hp) kill(defender, source); else recordHit(attacker, defender);
      return;
    }
    const attack = initialize(attacker), defence = initialize(defender);
    const result = militaryDamage(fightingType(attack), attacker.rank, defence.type, defender.rank, full, random.at("combat.blowDamage", attacker.actor));
    const attackerType = fightingType(attack), defenderType = fightingType(defence);
    const nationTroop = (type: typeof attackerType): NationTroop => type === "cavalry" ? "heavy" : type;
    // National advantages are player-only and apply to both field battles and sieges.
    const needsDoubleRoll = attack.faction === 0 && attackerType === "archer"
      && nationArcherDoubleChance(context.playerNation) > 0;
    const doubleRoll = needsDoubleRoll ? random.at("combat.nationalArcherDouble", attacker.actor)() : 1;
    const national = applyNationalAttack(result.damage, result.critical, context.playerNation,
      nationTroop(attackerType), attack.faction, doubleRoll);
    result.damage = applyNationalDefence(national.damage, context.playerNation,
      nationTroop(defenderType), defence.faction);
    result.critical = national.critical;
    result.damage *= multiplier * soldierBlowTalentFactor(context, attack.faction, defence.faction, archerPost);
    if (pointBlank) result.damage *= DOOR_ARCHER_DAMAGE;
    const ranged = fightingType(attack) === "archer" ||
      (attacker.commanderId !== undefined && context.commander?.rangedStyle() === true);
    const modifiers = context.commander?.modifyHit({ attacker, defender, ranged,
      random: random.at("combat.commanderDodge", defender.actor) }) ?? { damageFactor: 1, dodge: false };
    if (modifiers.dodge) { recordHit(attacker, defender); return; }
    result.damage *= modifiers.damageFactor;
    const attackerBody = actorById(attacker.actor), defenderBody = actorById(defender.actor);
    if (attackerBody && defenderBody) result.damage *= defenceFactor?.(attackerBody, defenderBody) ?? 1;
    const before = defence.hp;
    defence.hp = Math.max(0, defence.hp - result.damage);
    const source = reportBlow(attacker, defender, before, scriptSource);
    if (!defence.hp && defender.commanderId && context.commander?.incapacitate(defender)) return;
    if (!defence.hp) kill(defender, source);
    else recordHit(attacker, defender);
  };
  return { fell, hit };
};
