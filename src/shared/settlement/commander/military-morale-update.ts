import {
  MORALE_AURA_CALM_FACTOR, MORALE_BROKEN, MORALE_CALM_TICKS, MORALE_CORNERED_RANGE, MORALE_DEATH_RADIUS,
  MORALE_DEATH_RING, MORALE_DEATH_TICKS, MORALE_ENCIRCLE_RADIUS, MORALE_FORT_RADIUS, MORALE_OUTNUMBER_RADIUS,
  MORALE_STEADY, MORALE_UPDATE_TICKS, MORALE_WAVERING, type MoraleState
} from "../../balance/morale";
import type { MilitaryCombatant } from "../military-combat-rules";
import type { CombatCore, FieldMemory } from "../settlement-combat-core";
import type { SettlementSoldier } from "../settlement-military";
import type { SettlementActor } from "../settlement-types";
import { baseMorale, type MoraleInputs, nextMoraleState, stepMorale, targetMorale } from "./military-morale";
import { createMoraleEffects, type MoraleEffectSources } from "./military-morale-effects";
import { createMoraleSnapshot, healthShare } from "./military-morale-snapshot";
import { isMoraleTraceActive, traceMorale } from "./military-morale-trace";
import { createRoutRoute, type RoutThreat } from "./military-rout-route";

/** Saved morale state outside the soldiers' field memories: the recent falls per faction `[faction, x, z, tick]`. */
export interface MilitaryMoraleSave {
  deaths: [number, number, number, number][];
}

/** The friendly commander hero's aura this tick (A13: one read per tick, not one per soldier). */
export interface MoraleAura {
  faction: number;
  radius: number;
  x: number;
  z: number;
}

export interface MoraleSources extends MoraleEffectSources {
  aura: () => MoraleAura | undefined;
  /** The tick being simulated (the targeting's rescore clock: saved, equal after a reload or skip). */
  tick: () => number;
}

/** What one grid sweep round a soldier found (reused). */
interface Surroundings {
  enemyNear: boolean;
  enemyStrength: number;
  enemyX: number;
  enemyZ: number;
  enemies: number;
  ownStrength: number;
  routed: number;
  sectors: number;
}

/** One of 8 equal 45° wedges round a point (a partition by signs and the larger axis, no trigonometry). */
const sectorOf = (dx: number, dz: number) => {
  const quadrant = dx >= 0 ? (dz >= 0 ? 0 : 3) : (dz >= 0 ? 1 : 2);
  return quadrant * 2 + (Math.abs(dx) >= Math.abs(dz) ? 0 : 1);
};

/** Within `radius` of each other (squared distances: no root, exact). */
const within = (dx: number, dz: number, radius: number) => dx * dx + dz * dz <= radius * radius;

const countBits = (mask: number) => {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
};

/**
 * Field soldier morale (A14 plan §4). Each soldier in the open field updates once per `MORALE_UPDATE_TICKS`
 * on its rescore slot, with one grid sweep of `MORALE_OUTNUMBER_RADIUS`; falls go into a bounded ring per
 * faction. Garrisons, door fighters, besiegers and the commander hero are exempt (owner Q2). The values live in
 * the soldiers' saved field memories, so a reload or a quiet skip (no soldiers) continues exactly.
 */
export const createMilitaryMorale = (core: CombatCore, sources: MoraleSources) => {
  const { context, grid, memoryOf, sieges, soldiers } = core;
  const deaths = new Map<number, number[]>();
  const effects = createMoraleEffects(core, sources);
  const snapshot = createMoraleSnapshot(core);
  const around: Surroundings = { enemies: 0, enemyNear: false, enemyStrength: 0, enemyX: 0, enemyZ: 0,
    ownStrength: 0, routed: 0, sectors: 0 };
  const inputs: MoraleInputs = { aura: false, deaths: 0, fort: false, healthPercent: 100, ratioPercent: 0, rank: 0,
    routedNeighbours: 0, sectors: 0 };
  /**
   * Manned military buildings `[x, z, faction]` (centre) and their doors `[x, z, faction]` (rally points) of this
   * tick, and the aura, read once on the first update.
   */
  const forts: number[] = [], fortDoors: number[] = [], fortUids = new Set<number>();
  let preparedTick = -1, aura: MoraleAura | undefined;
  /** Reused rally lists of one faction: its hero `[x, z]` and its fort doors. */
  const hero: number[] = [], doors: number[] = [];
  const rout = createRoutRoute(core, snapshot, {
    awayPoint: effects.awayFrom,
    fortsOf: faction => {
      doors.length = 0;
      for (let index = 0; index < fortDoors.length; index += 3)
        if (fortDoors[index + 2] === faction) doors.push(fortDoors[index]!, fortDoors[index + 1]!);
      return doors;
    },
    heroOf: faction => {
      hero.length = 0;
      if (aura?.faction === faction) hero.push(aura.x, aura.z);
      return hero;
    },
    isClear: sources.isClear,
    retreat: sources.retreat,
    tick: sources.tick
  });

  const recordFall = (faction: number, x: number, z: number) => {
    let ring = deaths.get(faction);
    if (!ring) deaths.set(faction, ring = []);
    ring.push(x, z, sources.tick());
    if (ring.length > MORALE_DEATH_RING * 3) ring.splice(0, 3);
  };
  const prepare = (tick: number, entries: readonly SettlementActor[]) => {
    if (preparedTick === tick) return;
    preparedTick = tick;
    aura = sources.aura();
    snapshot.build(entries);
    forts.length = 0;
    fortDoors.length = 0;
    fortUids.clear();
    for (const soldier of soldiers.values()) {
      if (!soldier.stationed || soldier.building < 0 || fortUids.has(soldier.building)) continue;
      const site = context.buildingByUid?.get(soldier.building);
      if (!site) continue;
      fortUids.add(soldier.building);
      const faction = soldier.combat?.faction ?? 0;
      forts.push(site.x, site.z, faction);
      fortDoors.push(site.access.x, site.access.z, faction);
    }
  };
  const nearFort = (body: SettlementActor, faction: number) => {
    for (let index = 0; index < forts.length; index += 3)
      if (forts[index + 2] === faction && within(forts[index]! - body.x, forts[index + 1]! - body.z,
        MORALE_FORT_RADIUS)) return true;
    return false;
  };
  const recentDeaths = (body: SettlementActor, faction: number, tick: number) => {
    const ring = deaths.get(faction);
    let count = 0;
    if (!ring) return 0;
    for (let index = 0; index < ring.length; index += 3)
      if (tick - ring[index + 2]! < MORALE_DEATH_TICKS &&
        within(ring[index]! - body.x, ring[index + 1]! - body.z, MORALE_DEATH_RADIUS)) count++;
    return count;
  };
  const inAura = (body: SettlementActor, faction: number) =>
    Boolean(aura && aura.faction === faction && within(aura.x - body.x, aura.z - body.z, aura.radius));

  /** The soldier being surveyed (hoisted: the grid visitor allocates nothing per sweep). */
  let surveyed: SettlementActor = undefined!, surveyedFaction = 0, threatDistance = Infinity;
  /** The nearest known enemy within the cornered range of the surveyed soldier (NaN: none). */
  const threat: RoutThreat = { x: NaN, z: NaN };
  const anyone = () => true;
  const visit = (other: SettlementActor) => {
    const index = snapshot.indexOf(other.uid);
    if (index === undefined) return;
    if (snapshot.factionAt(index) === surveyedFaction) {
      around.ownStrength += snapshot.strengthAt(index);
      if (other !== surveyed && snapshot.isBroken(index)) around.routed++;
      return;
    }
    if (!snapshot.knows(surveyedFaction, other, index)) return;
    const dx = other.x - surveyed.x, dz = other.z - surveyed.z;
    around.enemyNear = true;
    around.enemies++;
    around.enemyStrength += snapshot.strengthAt(index);
    around.enemyX += other.x;
    around.enemyZ += other.z;
    if (within(dx, dz, MORALE_ENCIRCLE_RADIUS)) around.sectors |= 1 << sectorOf(dx, dz);
    const distance = dx * dx + dz * dz;
    if (distance <= MORALE_CORNERED_RANGE * MORALE_CORNERED_RANGE && distance < threatDistance) {
      threatDistance = distance;
      threat.x = other.x;
      threat.z = other.z;
    }
  };
  /** One sweep of the soldiers within the outnumber radius: own and known enemy strength, sectors, the routed. */
  const survey = (body: SettlementActor, faction: number) => {
    around.enemies = 0; around.enemyNear = false; around.enemyStrength = 0; around.enemyX = 0; around.enemyZ = 0;
    around.ownStrength = 0; around.routed = 0; around.sectors = 0;
    threat.x = NaN; threat.z = NaN; threatDistance = Infinity;
    surveyed = body; surveyedFaction = faction;
    grid.forEachWithin(body.x, body.z, MORALE_OUTNUMBER_RADIUS, anyone, visit);
  };

  /** Soldiers whose morale moves: in the open field, not at a door, a siege, a post or the hero. */
  const isExempt = (body: SettlementActor, soldier: SettlementSoldier) => {
    const state = soldier.combat!;
    return body.phase !== "militaryField" || state.towerFall !== undefined || soldier.commanderId !== undefined ||
      state.siege !== undefined || sieges.isDefender(body.uid) || sieges.atDoor(body.uid);
  };

  /** A fall to wavering falls back, a fall to broken routs; returns the soldiers ordered. */
  const applyEffects = (body: SettlementActor, state: MilitaryCombatant, memory: FieldMemory, previous: MoraleState,
    next: MoraleState, tick: number) => {
    if (next <= previous || next < MORALE_WAVERING) return 0;
    const enemy = around.enemies ? { x: around.enemyX / around.enemies, z: around.enemyZ / around.enemies } : body;
    if (next !== MORALE_BROKEN) return effects.fallBack(body, state, memory, enemy, tick);
    return sources.directlyControlled(body.uid) ? 0 : rout.begin(body, state.faction, memory, enemy);
  };

  /** A broken soldier keeps routing along its covered route; a rallied one's rout ends. */
  const followRout = (body: SettlementActor, state: MilitaryCombatant, memory: FieldMemory, next: MoraleState) => {
    if (next !== MORALE_BROKEN) { rout.end(memory); return; }
    if (!sources.directlyControlled(body.uid)) rout.follow(body, state.faction, memory, threat, state.destination);
  };

  const updateSoldier = (body: SettlementActor, soldier: SettlementSoldier, memory: FieldMemory, tick: number) => {
    const state = soldier.combat!, faction = state.faction;
    survey(body, faction);
    const aured = inAura(body, faction);
    inputs.aura = aured;
    inputs.deaths = recentDeaths(body, faction, tick);
    inputs.fort = nearFort(body, faction);
    inputs.healthPercent = Math.floor(100 * healthShare(state.hp, state.type, soldier.rank));
    // A striking flank soldier's grace: being outnumbered among the enemy's archers is the plan, not a scare.
    const graced = memory.strikeGrace !== undefined && tick < memory.strikeGrace;
    inputs.ratioPercent = around.enemyStrength > 0 && !graced
      ? Math.floor(100 * around.enemyStrength / around.ownStrength) : 0;
    inputs.rank = soldier.rank;
    inputs.routedNeighbours = around.routed;
    inputs.sectors = countBits(around.sectors);
    const value = stepMorale(memory.morale ?? baseMorale(soldier.rank), targetMorale(inputs));
    const step = MORALE_UPDATE_TICKS * (aured ? MORALE_AURA_CALM_FACTOR : 1);
    const calm = around.enemyNear ? 0 : Math.min(MORALE_CALM_TICKS, (memory.calm ?? 0) + step);
    const previous: MoraleState = memory.moraleState ?? MORALE_STEADY;
    const next = nextMoraleState(previous, value, calm);
    memory.morale = value;
    memory.calm = calm;
    memory.moraleState = next === MORALE_STEADY ? undefined : next;
    if (previous === MORALE_BROKEN) followRout(body, state, memory, next);
    if (next === previous) return;
    const ordered = applyEffects(body, state, memory, previous, next, tick);
    if (isMoraleTraceActive())
      traceMorale({ aura: aured, faction, from: previous, ordered, tick, to: next, uid: body.uid });
  };

  /** Once per tick after the grid is built: the field soldiers on this tick's update slot. */
  const update = (entries: readonly SettlementActor[]) => {
    const tick = sources.tick();
    for (const body of entries) {
      if ((tick + body.uid) % MORALE_UPDATE_TICKS !== 0) continue;
      const soldier = soldiers.get(body.uid);
      if (!soldier?.combat || isExempt(body, soldier)) continue;
      prepare(tick, entries);
      updateSoldier(body, soldier, memoryOf(body.uid), tick);
    }
  };

  const save = (): MilitaryMoraleSave | undefined => {
    const tick = sources.tick(), saved: MilitaryMoraleSave["deaths"] = [];
    for (const faction of [...deaths.keys()].sort((first, second) => first - second)) {
      const ring = deaths.get(faction)!;
      for (let index = 0; index < ring.length; index += 3)
        if (tick - ring[index + 2]! < MORALE_DEATH_TICKS)
          saved.push([faction, ring[index]!, ring[index + 1]!, ring[index + 2]!]);
    }
    return saved.length ? { deaths: saved } : undefined;
  };
  const restore = (saved: MilitaryMoraleSave | undefined) => {
    deaths.clear();
    preparedTick = -1;
    for (const [faction, x, z, tick] of saved?.deaths ?? []) {
      let ring = deaths.get(faction);
      if (!ring) deaths.set(faction, ring = []);
      ring.push(x, z, tick);
    }
  };
  return { recordFall, restore, save, update };
};

export type MilitaryMorale = ReturnType<typeof createMilitaryMorale>;

/** At most this many factions' falls are accepted in a save. */
const SAVED_FACTIONS_LIMIT = 64;

/** Null when `saved` (the optional `morale` block of a combat save) is well formed. */
export const militaryMoraleSaveError = (saved: unknown) => {
  if (saved === undefined) return null;
  const deaths = (saved as Partial<MilitaryMoraleSave> | null)?.deaths;
  if (!Array.isArray(deaths) || deaths.length > MORALE_DEATH_RING * SAVED_FACTIONS_LIMIT)
    return "Invalid military morale state";
  const valid = deaths.every(entry => Array.isArray(entry) && entry.length === 4 &&
    Number.isSafeInteger(entry[0]) && entry[0] >= 0 && Number.isFinite(entry[1]) && Number.isFinite(entry[2]) &&
    Number.isSafeInteger(entry[3]));
  return valid ? null : "Invalid military morale state";
};
