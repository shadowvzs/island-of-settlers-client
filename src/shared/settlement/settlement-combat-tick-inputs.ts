import { COMMANDER_PHASE } from "./commander/commander-phases";
import { strengthFrom } from "./commander/commander-squads";
import type { GarrisonCount } from "./commander/known-sites";
import {
  createFactionKnowledge, type FactionKnowledge, type KnownUnitRecord, type ObservedUnit
} from "./faction-knowledge";
import { militaryHealth } from "./military-combat-rules";
import type { CommanderUnit } from "./military-commander";
import { PLAYER_FACTION } from "./player-fog";
import { getBuilding } from "./settlement-building-index";
import { collectCommanderUnits } from "./settlement-combat-commands";
import type { CombatCore } from "./settlement-combat-core";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { rulesOf } from "./sim-rules";
import { markTickPhase } from "./tick-phase-profile";

/** The tick phase the combat update runs in; the commander's own phase returns to it. */
export const COMBAT_PHASE = "military.combat";

/** Runs the computer commander as its own tick phase (A14-0), measured apart from the combat update. */
export const updateCommanderPhase = (commander: { update: (dt: number) => void }, dt: number) => {
  markTickPhase(COMMANDER_PHASE);
  commander.update(dt);
  markTickPhase(COMBAT_PHASE);
};

/** The commander's per-tick inputs over this tick's grid entries, with reused arrays. */
export const createCommanderUnitSources = (
  gridEntries: readonly SettlementActor[], soldiers: ReadonlyMap<number, SettlementSoldier>,
  remember: (uid: number) => void, core: () => CombatCore, isDefender: (uid: number) => boolean,
  ownsResupply: (uid: number) => boolean, ownsDirectControl: (uid: number) => boolean
) => {
  const factions: number[] = [], candidates: SettlementActor[] = [], units: CommanderUnit[] = [];
  return {
    /**
     * Factions with a commander-eligible field soldier, without building CommanderUnits.
     * `remember` keeps collectCommanderUnits' per-tick FieldMemory side effect (it is saved
     * and therefore part of the state hash) even on ticks when no faction decides.
     */
    factions: () => {
      factions.length = 0;
      for (const body of gridEntries) {
        const state = soldiers.get(body.uid)?.combat;
        // Mirror collectCommanderUnits exactly: inField() also rejects a mid-tick tower fall
        // and an invisible body, which the grid snapshot from earlier in the tick cannot know.
        if (!state || !body.visible || state.towerFall || body.phase !== "militaryField" ||
          isDefender(body.uid) || ownsResupply(body.uid) || ownsDirectControl(body.uid)) continue;
        remember(body.uid);
        factions.push(state.faction);
      }
      return factions;
    },
    /** Field soldiers as the commander sees them; built only when a faction decides. */
    units: () => {
      candidates.length = 0;
      for (const body of gridEntries)
        if (!ownsResupply(body.uid) && !ownsDirectControl(body.uid)) candidates.push(body);
      return collectCommanderUnits(core(), candidates, units);
    }
  };
};

/** A reusable target source for the archery update (door duellists excluded). */
export const createArcheryTargetSource = () => {
  const targets: SettlementActor[] = [];
  return (gridEntries: readonly SettlementActor[], isDefender: (uid: number) => boolean) => {
    targets.length = 0;
    for (const body of gridEntries) if (!isDefender(body.uid)) targets.push(body);
    return targets;
  };
};

/** Refills an actor uid index from the live actor list (the map is reused, not reallocated). */
export const refreshActorIndex = (
  actors: readonly SettlementActor[], index: Map<number, SettlementActor>
) => {
  index.clear();
  for (const actor of actors) index.set(actor.uid, actor);
};

/**
 * Every soldier the faction knowledge may observe this tick: visible, in the field or at a siege, not falling
 * from a tower (the combat grid's members). The unit objects are reused: the knowledge copies what it keeps.
 */
export const createObservedUnitSource = (
  soldiers: ReadonlyMap<number, SettlementSoldier>, actorById: (uid: number) => SettlementActor | undefined
) => {
  const units: ObservedUnit[] = [];
  const pool: ObservedUnit[] = [];
  return () => {
    units.length = 0;
    for (const soldier of soldiers.values()) {
      const state = soldier.combat, body = actorById(soldier.actor);
      if (!state || state.towerFall || !body?.visible || (body.phase !== "militaryField" &&
        body.phase !== "militarySiege")) continue;
      const unit = pool[units.length] ??= { faction: 0, health: 0, rank: 0, type: "shield", uid: 0, x: 0, z: 0 };
      unit.faction = state.faction; unit.health = state.hp / militaryHealth(state.type, soldier.rank);
      unit.rank = soldier.rank; unit.type = state.type; unit.uid = body.uid; unit.x = body.x; unit.z = body.z;
      units.push(unit);
    }
    return units;
  };
};

/** A remembered enemy as the commander weighs it: its last known strength at its last known place. */
const rememberedUnit = (record: KnownUnitRecord): CommanderUnit => {
  const place = { x: record.x, z: record.z };
  return { busy: false, faction: record.faction, fighting: false, health: record.health, home: place,
    marching: false, rank: record.rank, remembered: true, type: record.type, uid: record.uid, x: place.x, z: place.z };
};

/**
 * The commander's view for one deciding faction (A13 phase 3): its own soldiers, the enemy soldiers it knows
 * now (seen or under a hit alert) and, for enemies it no longer knows, their last known memory. A level with a
 * reaction delay (`reactionTicks`, A14 plan §6-§7) weighs an enemy only once it has known it that long without
 * a break; its soldiers' own targeting is not delayed.
 */
export const createCommanderPerception = (
  knowledge: FactionKnowledge, reactionTicks: (faction: number) => number
) => {
  const view: CommanderUnit[] = [], known = new Set<number>();
  const isKnownNow = (uid: number) => known.has(uid);
  return (faction: number, units: readonly CommanderUnit[]) => {
    view.length = 0; known.clear();
    const delay = reactionTicks(faction), latest = knowledge.now() - delay;
    for (const unit of units) {
      if (unit.faction === faction) { view.push(unit); continue; }
      if (!knowledge.knows(faction, unit)) continue;
      known.add(unit.uid);
      // Known long enough; an enemy first known this tick is not in the memory yet.
      if (delay === 0 || (knowledge.knownSince(faction, unit.uid) ?? Infinity) <= latest) view.push(unit);
    }
    for (const record of knowledge.remembered(faction, isKnownNow)) {
      // A remembered comrade (a captured faction change) is never weighed as an enemy.
      if (record.faction !== faction && record.firstKnownTick <= latest) view.push(rememberedUnit(record));
    }
    return view;
  };
};

/**
 * The soldiers inside a building as the strategic knowledge counts them when the building is in a computer
 * faction's sight (A14-4b `garrisonSeen`; called on a first sighting and at most once a second per site).
 */
const createGarrisonCount = (soldiers: ReadonlyMap<number, SettlementSoldier>) => {
  const count: GarrisonCount = { count: 0, strength: 0 };
  return (uid: number) => {
    count.count = 0; count.strength = 0;
    for (const soldier of soldiers.values()) {
      const state = soldier.combat;
      if (soldier.building !== uid || !soldier.stationed || !state) continue;
      count.count++;
      count.strength += Math.floor(strengthFrom(state.hp / militaryHealth(state.type, soldier.rank), state.type,
        soldier.rank) * 100);
    }
    return count;
  };
};

/**
 * The island's faction knowledge over its soldiers, installed on the context for the vision phase and the
 * economy's readers. `nextTick` advances the fallback clock of bare fixtures without a game clock.
 */
export const createCombatKnowledge = (
  context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>,
  actorById: (uid: number) => SettlementActor | undefined,
  isEnemyOf: (faction: number) => (body: SettlementActor) => boolean
) => {
  let fallbackTick = 0;
  const now = () => context.clock ? context.clock.tick() : fallbackTick;
  const knowledge = createFactionKnowledge({
    building: uid => getBuilding(context, uid),
    buildings: () => context.buildings,
    garrison: createGarrisonCount(soldiers),
    now,
    // The pinned player troop sight rule (owner 2026-11-13): off lets the player's troops act on every enemy.
    omniscient: viewer => viewer === PLAYER_FACTION && !rulesOf(context).playerTroopsSightOnly,
    sees: () => context.factionVision?.sees,
    stationedIn: uid => {
      const soldier = soldiers.get(uid);
      return soldier?.stationed ? soldier.building : undefined;
    },
    units: createObservedUnitSource(soldiers, actorById),
    vision: () => context.factionVision
  });
  context.factionKnowledge = knowledge;
  /**
   * An enemy soldier `faction` knows now (seen by its layer or under its hit alert); every enemy, as before
   * A13 phase 3, while the sight rule waives knowledge for the faction (resolved once per query).
   */
  const isKnownEnemyOf = (faction: number) => {
    const enemy = isEnemyOf(faction);
    if (knowledge.omniscient(faction)) return enemy;
    return (body: SettlementActor) => enemy(body) && knowledge.knows(faction, body);
  };
  return { isKnownEnemyOf, knowledge, nextTick: () => { fallbackTick++; } };
};
