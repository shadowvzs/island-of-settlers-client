import {
  ARCHER_SCAFFOLD_SITE, banditCampPlan, placedBanditCamp
} from "../../render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { COLONY_FORT_RANKS } from "../balance/colonies";
import { DIFFICULTY_TOWER_ARCHERS } from "../balance/enemy-scaling";
import { FORT_COLLAPSE_SECONDS } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { emitIslandEvent } from "../script-world/script-unit-events";
import type { WorldData } from "../world/world-data";
import { findDefenceSite, garrisonDefenceSite } from "./adventure-camp-defences";
import type { ColonyIsland } from "./colony-expedition-rules";
import {
  colonyAllowsBuilding, colonyBuildingRefusal, colonyDefenderRank, type ColonyFortPlan, colonyFortPlans,
  colonyOverflowDefenders
} from "./colony-island-rules";
import { marblePlotBlocked } from "./colony-marble-deposits";
import { difficultyArcherTowers } from "./difficulty";
import { FACING_PASSES, islandCentre, turnsFacing } from "./enemy-building-facing";
import { addBattleTroops, copyBattleRecord, createBattleRecord,   type ExpeditionBattleRecord,recordBattleDeath } from "./expedition-battle-record";
import { FORT_REMOVAL_SECONDS, siteStructure } from "./fort-assault-rules";
import type { MilitaryTroopType } from "./military-combat-rules";
import { isMonumentStartGarrison } from "./monument-start-garrison";
import { addGood } from "./production-rules";
import { type ColonyCounterattackSave,createColonyCounterattacks } from "./settlement-colony-counterattack";
import { type ColonyFortState,hostileFortStatus, watchHostileForts } from "./settlement-colony-forts";
import { removeSettlementBuilding } from "./settlement-demolition";
import { findHomeBuilding } from "./settlement-home";
import type { createSettlementMilitary, EmigratedTroop } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import { groundPath } from "./settlement-paths";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import { publicTerrainPath } from "./settlement-terrain-routing";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export type ColonyStatus = "contested" | "conquered" | "defeated";
/** Crew settlers come from the simulation's `initialSettlers`; troops and wares land here. */
export interface ColonySetup {
  /** Monument harbour defenders (`monumentStartGarrison`), stationed at the harbour; absent without one. */
  defenders?: EmigratedTroop[];
  island: ColonyIsland;
  landed: Goods;
  troops: EmigratedTroop[];
}
export interface SettlementColonySave {
  version: 1;
  battle?: ExpeditionBattleRecord;
  island: ColonyIsland;
  status: ColonyStatus;
  forts: number;
  /** Wall-clock milliseconds; a conquered colony is freed 14 calendar days later. */
  conqueredAt?: number;
  /** Enemy counterattacks on captured forts (medium and hard); absent before the first capture. */
  counterattack?: ColonyCounterattackSave;
}

const FORT_MIN_DISTANCE = 14;
/** Forts stand this far apart, so no fort's archers cover another's door queue (2026-10-13; was 9). */
const FORT_SPACING = 14;
const CANDIDATE_STEP = 2;
/** Rings of spawn points (0.8 tiles apart) searched around a door; outer ones only when inner are full. */
const SPAWN_RINGS = 6;
/** Fort layouts tried before a colony start fails (the world choice then regenerates the island). */
const PLACEMENT_ATTEMPTS = 3;

type SettlementMilitary = ReturnType<typeof createSettlementMilitary>;

/** Plot candidates on a coarse grid, farthest from `origin` (home harbour or landing beach) first. */
export const fortCandidates = (context: SettlementContext, origin: SettlementPoint) => {
  const { world } = context.options;
  const points: Array<{ x: number; z: number; distance: number }> = [];
  for (let z = 2; z < world.cellsZ - 2; z += CANDIDATE_STEP) for (let x = 2; x < world.cellsX - 2; x += CANDIDATE_STEP) {
    const distance = DMath.hypot(x - origin.x, z - origin.z);
    if (distance >= FORT_MIN_DISTANCE) points.push({ distance, x, z });
  }
  return points.sort((a, b) => b.distance - a.distance);
};

const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

interface FloodWorkspace {
  epoch: number;
  marks: Int32Array;
  occupancy: Uint8Array;
  queue: Int32Array;
}

const createFloodWorkspace = (cells: number): FloodWorkspace => ({
  epoch: 0, marks: new Int32Array(cells), occupancy: new Uint8Array(cells),
  queue: new Int32Array(cells)
});

/** Whole-cell flood that stops as soon as every target is marked. */
const reachesAllCells = (world: WorldData, occupied: Uint8Array, from: SettlementPoint,
  targets: readonly SettlementPoint[], workspace: FloodWorkspace) => {
  const width = world.cellsX, epoch = ++workspace.epoch;
  const marks = workspace.marks, queue = workspace.queue, pending = new Set<number>();
  for (const target of targets) pending.add(Math.floor(target.z) * width + Math.floor(target.x));
  if (pending.size === 0) return true;
  const first = Math.floor(from.z) * width + Math.floor(from.x);
  marks[first] = epoch; queue[0] = first;
  let head = 0, tail = 1;
  while (head < tail) {
    const cell = queue[head++]!;
    pending.delete(cell);
    if (pending.size === 0) return true;
    const x = cell % width, z = (cell - x) / width;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= world.cellsZ || marks[next] === epoch) continue;
      if (!world.walkCost[next] || occupied[next] === 1) continue;
      marks[next] = epoch;
      queue[tail++] = next;
    }
  }
  return pending.size === 0;
};

/**
 * Cells joined to `from` by walkable, unoccupied cells (4-neighbour flood fill). A cheap filter
 * before exact ground paths: a failed path search on a big map scans the whole island.
 */
export const reachableCells = (context: SettlementContext, from: SettlementPoint) => {
  const { world } = context.options, width = world.cellsX;
  const reachable = new Uint8Array(world.cellsX * world.cellsZ);
  const first = Math.floor(from.z) * width + Math.floor(from.x), queue = [first];
  reachable[first] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % width, z = (cell - x) / width;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= world.cellsZ || reachable[next]) continue;
      if (!world.walkCost[next] || context.occupied[next] === 1) continue;
      reachable[next] = 1;
      queue.push(next);
    }
  }
  return (point: SettlementPoint) => reachable[Math.floor(point.z) * width + Math.floor(point.x)] === 1;
};

const occupyFootprint = (occupied: Uint8Array, site: SettlementBuilding, cellsX: number) => {
  for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
    for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++) occupied[z * cellsX + x] = 1;
};

/**
 * With the new plot in place, its door and every door planned before it stay joined to the harbour
 * through whole cells (no diagonal squeeze between plots or rocks).
 */
const keepsDoorsReachable = (
  scratch: SettlementContext, home: SettlementBuilding, sites: readonly SettlementBuilding[],
  candidate: SettlementBuilding, workspace: FloodWorkspace
) => {
  workspace.occupancy.set(scratch.occupied);
  occupyFootprint(workspace.occupancy, candidate, scratch.options.world.cellsX);
  return reachesAllCells(scratch.options.world, workspace.occupancy, home.access,
    [candidate.access, ...sites.map(site => site.access)], workspace);
};

/** A hostile plot centred on a candidate grid point after `turns` quarter turns (unclaimed). */
const hostileCandidate = (
  scratch: SettlementContext, plan: ColonyFortPlan, point: SettlementPoint, turns: number
) => {
  const { bandit } = plan;
  const blueprint = bandit && banditCampPlan(bandit);
  const [baseWidth, baseDepth] = blueprint?.cells ?? getBuildingDefinition(plan.typeId).gridFootprint;
  const width = turns % 2 ? baseDepth : baseWidth, depth = turns % 2 ? baseWidth : baseDepth;
  const next = scratch.nextBuilding;
  const x = point.x + width % 2 / 2, z = point.z + depth % 2 / 2;
  const candidate = makeBuilding(scratch, plan.typeId, x, z, turns);
  scratch.nextBuilding = next;
  if (!bandit || !blueprint) return candidate;
  candidate.bandit = bandit;
  candidate.enemyCampEnclosure = "building";
  Object.assign(candidate, placedBanditCamp(bandit, x, z, turns));
  candidate.hasDoor = blueprint.kind !== "tower";
  return candidate;
};

/** Farthest reachable plots first, spaced apart; planned on scratch occupancy before claiming. */
const planForts = (
  context: SettlementContext, plans: readonly ColonyFortPlan[], excluded: readonly SettlementPoint[] = []
) => {
  const home = findHomeBuilding(context)!;
  const scratch = { ...context, buildings: context.buildings.slice(), occupied: context.occupied.slice() };
  const reachable = reachableCells(context, home.access);
  const flood = createFloodWorkspace(context.options.world.cellsX * context.options.world.cellsZ);
  const centre = islandCentre(context.options.world);
  const candidates = fortCandidates(context, home), sites: SettlementBuilding[] = [];
  const isLegal = (candidate: SettlementBuilding) => !placementReason(scratch, candidate) &&
    !marblePlotBlocked(context, candidate) && reachable(candidate.access) &&
    keepsDoorsReachable(scratch, home, sites, candidate, flood) &&
    !!(groundPath(scratch, home.access, candidate.access) ??
      publicTerrainPath(scratch, home.access, candidate.access));
  const isSpaced = (point: SettlementPoint) =>
    !sites.some(existing => DMath.hypot(existing.x - point.x, existing.z - point.z) < FORT_SPACING) &&
    !excluded.some(failed => DMath.hypot(failed.x - point.x, failed.z - point.z) < FORT_SPACING);
  const siteAt = (plan: ColonyFortPlan, point: SettlementPoint, ranks: readonly [number, number]) => {
    for (const turns of turnsFacing(point, centre).slice(...ranks)) {
      const candidate = hostileCandidate(scratch, plan, point, turns);
      if (isLegal(candidate)) return candidate;
    }
    return undefined;
  };
  // Each front faces the island centre: the farthest plot that allows it wins; only when none
  // does, the next closest turns are tried.
  const findSite = (plan: ColonyFortPlan) => {
    for (const ranks of FACING_PASSES) for (const point of candidates) {
      if (!isSpaced(point)) continue;
      const site = siteAt(plan, point, ranks);
      if (site) return site;
    }
    return undefined;
  };
  for (const plan of plans) {
    const site = findSite(plan);
    if (!site) return null;
    site.construction = 1; site.required = {}; site.foundationProgress = 1; site.militaryFaction = 1;
    site.uid = scratch.nextBuilding++;
    scratch.buildings.push(site);
    occupyFootprint(scratch.occupied, site, context.options.world.cellsX);
    sites.push(site);
  }
  return sites;
};

type PointCheck = (point: SettlementPoint) => boolean;

interface HostileSpawnOptions {
  /** Computer faction of the spawned soldier (authored scenarios may field several). */
  faction?: number;
  /** Existing formation positions the new soldier must stay clear of. */
  formation?: { positions: SettlementPoint[]; spacing: number };
  /** Keeps soldiers off ground the player's troops cannot walk to (rocks, sand spits). */
  reachable?: PointCheck;
}

/** One hostile soldier on the first free point in rings around `centre`; null when none fits. */
export const spawnHostileNear = (
  military: SettlementMilitary, centre: SettlementPoint, type: MilitaryTroopType, rank = 0,
  options: HostileSpawnOptions = {}
) => {
  const { faction = 1, formation, reachable = () => true } = options;
  for (let ring = 1; ring <= SPAWN_RINGS; ring++) for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8;
    const point = { x: centre.x + DMath.cos(angle) * ring * .8, z: centre.z + DMath.sin(angle) * ring * .8 };
    if (formation?.positions.some(other =>
      DMath.hypot(other.x - point.x, other.z - point.z) < formation.spacing)) continue;
    if (!reachable(point)) continue;
    const id = military.combat.spawnOpponent(point, type, rank, faction);
    if (id !== null) {
      formation?.positions.push(point);
      return id;
    }
  }
  return null;
};

/** Spawns a claimed hostile site's planned defenders; they are garrisoned once every fort is manned. */
const spawnDefenders = (
  military: SettlementMilitary, site: SettlementBuilding, plan: ColonyFortPlan, reachable?: PointCheck
) => plan.troops.flatMap((type, index) => {
  const id = spawnHostileNear(military, site.access, type, plan.ranks[index], { reachable });
  return id === null ? [] : [id];
});

/** Claims planned hostile sites and spawns their defenders on ground the home harbour reaches. */
const raiseForts = (
  context: SettlementContext, military: SettlementMilitary, sites: SettlementBuilding[],
  plans: readonly ColonyFortPlan[]
) => {
  for (const site of sites) claimBuilding(context, site);
  context.nextBuilding = Math.max(context.nextBuilding, ...sites.map(site => site.uid + 1));
  const reachable = reachableCells(context, findHomeBuilding(context)!.access);
  return sites.map((site, index) => spawnDefenders(military, site, plans[index]!, reachable));
};

const garrisonForts = (
  military: SettlementMilitary, sites: readonly SettlementBuilding[], plans: readonly ColonyFortPlan[],
  defenders: readonly number[][]
) => sites.forEach((site, index) => {
  military.combat.registerGarrison(site.uid, defenders[index]!, 1, plans[index]!.doorHp, siteStructure(site));
  site.status = hostileFortStatus(defenders[index]!.length);
});

/**
 * The global difficulty's extra archer towers (enemy scaling table) plus the towers that man the defenders the
 * camps cannot hold (`colonyOverflowDefenders`): each beside a fort, round-robin, with two new archers of the
 * island's top fort rank (plus the tier bonus). A tower without a legal plot is skipped, so a harder level never
 * fails a colony start. Returns the towers raised (none at Normal).
 */
const raiseDifficultyTowers = (
  context: SettlementContext, military: SettlementMilitary, forts: readonly SettlementBuilding[],
  island: ColonyIsland
) => {
  const overflow = colonyOverflowDefenders(island.difficulty, island.seed, context.difficulty);
  const extra = difficultyArcherTowers(context.difficulty) + Math.ceil(overflow / DIFFICULTY_TOWER_ARCHERS);
  if (!extra || !forts.length) return 0;
  const shore = findHomeBuilding(context)!.access;
  const topRank = COLONY_FORT_RANKS[island.difficulty].at(-1)!;
  const rank = colonyDefenderRank(island.difficulty, topRank, context.difficulty);
  let raised = 0;
  for (let tower = 0; tower < extra; tower++) {
    const fort = forts[tower % forts.length]!;
    const site = findDefenceSite(context, ARCHER_SCAFFOLD_SITE, fort, forts, shore);
    if (!site) continue;
    const ids: number[] = [];
    const recruit = () => {
      for (let archer = 0; archer < DIFFICULTY_TOWER_ARCHERS; archer++) {
        const id = spawnHostileNear(military, site.access, "archer", rank);
        if (id !== null) ids.push(id);
      }
      return ids;
    };
    if (garrisonDefenceSite(context, military, site, recruit)) raised++;
    else for (const id of ids) military.combat.withdrawOpponent(id);
  }
  return raised;
};

/** Undoes `raiseForts` when a fort cannot be fully manned: the island is left as it was. */
const razeForts = (
  context: SettlementContext, military: SettlementMilitary, sites: readonly SettlementBuilding[],
  defenders: readonly number[][]
) => {
  for (const id of defenders.flat()) military.combat.withdrawOpponent(id);
  for (const site of sites) {
    removeSettlementBuilding(context, site);
    context.options.onBuildingDemolished?.(site);
  }
};

/** Colony island: emigrants land at the harbour, hostile forts hold the rest until captured. */
export const createSettlementColony = (
  context: SettlementContext, military: SettlementMilitary, now: () => number
) => {
  let state: Omit<SettlementColonySave, "counterattack"> | undefined;
  let forts: ColonyFortState[] = [];
  const counterattacks = createColonyCounterattacks(context, military);
  const hostileForts = () => context.buildings.filter(building => ownerOf(building) > 0);
  const structureOf = (uid: number) => military.combat.doors().find(door => door.building === uid)?.structure;
  /** Seconds since a fort's walls fell (undefined while they stand). */
  const fallenFor = (fort: SettlementBuilding) => structureOf(fort.uid)?.fallen;
  /** A fort counts until its walls have fallen and collapsed. */
  const standingForts = () => hostileForts().filter(fort => (fallenFor(fort) ?? -1) < FORT_COLLAPSE_SECONDS);
  /** Forts of saves from before 2026-10-13 gain walls: colony forts are destroyed, not captured. */
  const fortifyForts = () => {
    for (const fort of hostileForts()) {
      const structure = siteStructure(fort);
      if (structure && !structureOf(fort.uid)) military.combat.fortify(fort.uid, structure);
    }
  };
  /** A burnt-down fort's charred ruin is cleared: the plot becomes free ground. */
  const clearRuins = () => {
    for (const fort of hostileForts()) {
      if ((fallenFor(fort) ?? 0) < FORT_REMOVAL_SECONDS) continue;
      military.removeBuilding(fort.uid);
      removeSettlementBuilding(context, fort);
      context.options.onBuildingDemolished?.(fort);
    }
  };
  const playerTroops = () => military.soldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0 &&
    !soldier.commanderId).length;
  /**
   * Owner 2026-11-09: the garrison of a removed or destroyed enemy fort (fallen tower archers included)
   * comes out and keeps fighting; the colony is conquered only when no enemy soldier is left alive.
   */
  const livingEnemySoldiers = () => military.soldiers().some(soldier =>
    (soldier.combat?.faction ?? 0) > 0 && (soldier.combat?.hp ?? 0) > 0);
  /**
   * Plans and mans every fort; a fort short of defenders is undone and its plot avoided on the next
   * try. The world choice dry-runs this, so an island where it never succeeds is regenerated.
   */
  const manForts = (plans: readonly ColonyFortPlan[]) => {
    const excluded: SettlementPoint[] = [];
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const sites = planForts(context, plans, excluded);
      if (!sites) return null;
      const defenders = raiseForts(context, military, sites, plans);
      const short = sites.filter((_site, index) => defenders[index]!.length < plans[index]!.troops.length);
      if (!short.length) return { defenders, sites };
      razeForts(context, military, sites, defenders);
      excluded.push(...short.map(site => ({ x: site.x, z: site.z })));
    }
    return null;
  };
  const start = (setup: ColonySetup) => {
    if (state) return { ok: false as const, reason: "This colony is already settled" };
    if (!isMonumentStartGarrison(setup.defenders))
      return { ok: false as const, reason: "These harbour defenders are not the Monument's" };
    const home = findHomeBuilding(context)!;
    const plans = colonyFortPlans(setup.island.difficulty, setup.island.seed, context.difficulty);
    const forts = manForts(plans);
    if (!forts) return { ok: false as const, reason: "No reachable room for every enemy fort and defender" };
    const { sites } = forts;
    garrisonForts(military, sites, plans, forts.defenders);
    const towers = raiseDifficultyTowers(context, military, sites, setup.island);
    home.inventory = {};
    for (const [ware, count] of Object.entries(setup.landed)) addGood(home.inventory, ware, count);
    military.immigrate(setup.troops);
    const defenders = setup.defenders ?? [];
    if (defenders.length) military.station(defenders);
    state = { battle: createBattleRecord([...setup.troops, ...defenders], context.buildings), forts: sites.length + towers, island: { ...setup.island }, status: "contested", version: 1 };
    return { ok: true as const };
  };
  const resultId = (island: ColonyIsland) => `colony:${island.id}:${island.seed}`;
  /** `dt`: seconds since the last update (the simulation's scheduling interval). */
  const update = (dt: number) => {
    if (!state) return;
    fortifyForts();
    clearRuins();
    if (state.status !== "contested") return;
    forts = watchHostileForts(context, military, hostileForts());
    if (!standingForts().length && !livingEnemySoldiers()) {
      state.status = "conquered";
      state.conqueredAt = now();
      military.commander.recordMissionResult(resultId(state.island));
      if (context.script) emitIslandEvent(context, "colonyConquered");
      return;
    }
    if (!playerTroops()) {
      state.status = "defeated";
      military.commander.recordMissionFailure(resultId(state.island));
      if (context.script) emitIslandEvent(context, "colonyDefeated");
      return;
    }
    const struck = forts.some(fort => fort.fallen !== undefined) || hostileForts().length < state.forts;
    counterattacks.update(dt, state.island.difficulty, struck);
  };
  const save = (): SettlementColonySave | undefined => {
    if (!state) return undefined;
    const saved = { ...state, battle: copyBattleRecord(state.battle), island: { ...state.island } }, counterattack = counterattacks.save();
    return counterattack ? { ...saved, counterattack } : saved;
  };
  const restore = (saved?: SettlementColonySave) => {
    const { battle: _battle, counterattack, ...rest } = saved ?? {};
    state = saved && { battle: copyBattleRecord(saved.battle), ...rest as Omit<SettlementColonySave, "counterattack">, island: { ...saved.island } };
    if (saved) for (const site of hostileForts())
      if (site.bandit !== undefined) site.enemyCampEnclosure = "building";
    counterattacks.restore(counterattack);
  };
  return {
    recordDeath: (type: import("./military-combat-rules").MilitaryTroopType, faction: number) => {
      if (state?.status === "contested") recordBattleDeath(state.battle, type, faction);
    },
    recordArrivals: (troops: readonly EmigratedTroop[]) => {
      if (state?.status === "contested") addBattleTroops(state.battle, troops);
    },
    allowsBuilding: (typeId: number) =>
      !state || colonyAllowsBuilding(typeId, state.status === "conquered"),
    buildingRefusal: () => colonyBuildingRefusal(state?.status === "conquered"),
    isRaider: counterattacks.isRaider,
    /**
     * A completed colony with no hostile fort or ruin left: `fortifyForts`/`clearRuins` loop over
     * nothing, the contested watch/win check is skipped, and no raid ship or raider can advance.
     * `landTime`/`shipTime` only move while a hostile fort remains.
     */
    quietSkip: () => {
      if (!state) return true;
      if (state.status === "contested" || hostileForts().length) return false;
      return !counterattacks.hasLiveRaiders();
    },
    save,
    restore,
    shipFrames: counterattacks.shipFrames,
    shipSites: counterattacks.shipSites,
    snapshot: () => state && { ...state, counterattack: counterattacks.snapshot(),
      fortStates: forts.map(fort => ({ ...fort })), hostileForts: standingForts().length, island: { ...state.island } },
    start,
    update,
    updateActor: counterattacks.updateActor
  };
};
