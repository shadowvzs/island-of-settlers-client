import type { AdventureCampFrame } from "../../render-common/adventure/adventure-camp";
import { DMath } from "../math/deterministic-math";
import { raiseAdventureDefences } from "./adventure-camp-defences";
import { recoverCampOverlaps } from "./adventure-camp-recovery";
import { rankAdventureCampSites } from "./adventure-camp-sites";
import { type AdventureCampPlan, adventureEnemyPlan, type AdventureIsland } from "./adventure-rules";
import { addBattleTroops, copyBattleRecord, createBattleRecord,   type ExpeditionBattleRecord,recordBattleDeath } from "./expedition-battle-record";
import { FORT_REMOVAL_SECONDS } from "./fort-assault-rules";
import { militaryGroundPath } from "./military-routing";
import {
type AdventureLanding,
  createAdventureLanding, findAdventureLanding, gatherSlot} from "./settlement-adventure-landing";
import { fortCandidates, reachableCells, spawnHostileNear } from "./settlement-colony";
import { watchHostileForts } from "./settlement-colony-forts";
import { removeSettlementBuilding } from "./settlement-demolition";
import type { createSettlementMilitary, EmigratedTroop } from "./settlement-military";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

export type AdventureStatus = "contested" | "won" | "defeated";
export interface AdventureSetup { island: AdventureIsland; troops: EmigratedTroop[] }
export interface SettlementAdventureSave {
  version: 1;
  battle?: ExpeditionBattleRecord;
  island: AdventureIsland;
  status: AdventureStatus;
  /** Hostile soldiers raised on arrival (field camps; older saves also counted fort defenders). */
  enemies: number;
  /** Actual field-camp centres; layout and solid shells are derived deterministically. Older saves omit them. */
  campSites?: SettlementPoint[];
  /** Wall-clock milliseconds of the victory or defeat. */
  endedAt?: number;
  /** The anchored landing ship and its gangway; absent in saves from before 2026-10-13 (harbour landing). */
  landing?: AdventureLanding;
}

/** No camp stands this close to the landing beach, so the troops come ashore unopposed. */
export const CAMP_LANDING_DISTANCE = 24;
const CAMP_SPACING = 9;
/** Loose field formations, rather than soldiers packed shoulder to shoulder. */
export const CAMP_UNIT_SPACING = 1.6;
/** Camp layouts tried before an adventure start fails (the world choice then regenerates the island). */
const PLACEMENT_ATTEMPTS = 3;

type SettlementMilitary = ReturnType<typeof createSettlementMilitary>;

const clearance = (point: SettlementPoint, taken: readonly SettlementPoint[]) =>
  Math.min(...taken.map(other => DMath.hypot(other.x - point.x, other.z - point.z)));

/** Camps share an inland enemy area opposite the beach, with separate assembly space and valid routes. */
const planCampSites = (
  context: SettlementContext, count: number, beach: SettlementPoint, excluded: readonly SettlementPoint[] = []
) => {
  const coarseReachable = reachableCells(context, beach), sites: SettlementPoint[] = [];
  const mountedStart = gatherSlot(context, beach, 0);
  const checked = new Map<string, boolean>();
  // Cache the spawn rings shared by every soldier: exact route checks run once per point.
  const reachable = (point: SettlementPoint) => {
    const key = `${point.x},${point.z}`;
    const known = checked.get(key);
    if (known !== undefined) return known;
    const accessible = coarseReachable(point) && isMountedNavigationClear(context, point) &&
      Boolean(militaryGroundPath(context, beach, point)) &&
      Boolean(militaryGroundPath(context, mountedStart, point, true));
    checked.set(key, accessible);
    return accessible;
  };
  const open = fortCandidates(context, beach).filter(candidate => candidate.distance >= CAMP_LANDING_DISTANCE)
    .map(candidate => ({ x: candidate.x + .5, z: candidate.z + .5 }))
    .filter(point => coarseReachable(point) && isNavigationClear(context, point) &&
      !excluded.some(failed => DMath.hypot(failed.x - point.x, failed.z - point.z) < CAMP_SPACING));
  const ranked = rankAdventureCampSites(open, beach, {
    x: context.options.world.cellsX / 2, z: context.options.world.cellsZ / 2
  });
  for (const site of ranked) {
    if (clearance(site, sites) < CAMP_SPACING || !reachable(site)) continue;
    sites.push(site);
    if (sites.length === count) return { reachable, sites };
  }
  if (sites.length < count) return null;
  return { reachable, sites };
};

/** Ids of the camp's spawned soldiers (fewer than planned when its ground is crowded). */
const raiseCamp = (
  military: SettlementMilitary, site: SettlementPoint, camp: AdventureCampPlan,
  reachable: (point: SettlementPoint) => boolean, positions: SettlementPoint[]
) => camp.troops.flatMap((type, index) => {
  const id = spawnHostileNear(military, site, type, camp.ranks[index],
    { formation: { positions, spacing: CAMP_UNIT_SPACING }, reachable });
  return id === null ? [] : [id];
});

/**
 * Adventures remain primarily field battles, with occasional towers and rare fortified camps.
 * Victory requires every hostile soldier and structure to be defeated.
 */
export const createSettlementAdventure = (
  context: SettlementContext, military: SettlementMilitary, now: () => number
) => {
  let campRevision = 0;
  let state: Omit<SettlementAdventureSave, "landing"> | undefined;
  const landing = createAdventureLanding(context, military);
  const hostileBuildings = () => context.buildings.filter(building => ownerOf(building) > 0);
  const soldiersOf = (hostile: boolean) => military.soldiers()
    .filter(soldier => ((soldier.combat?.faction ?? 0) > 0) === hostile &&
      (hostile || !soldier.commanderId)).length;
  /**
   * Plans and mans every camp; a camp short of soldiers is withdrawn and its ground avoided on the
   * next try. The world choice dry-runs this, so an island where it never succeeds is regenerated.
   */
  const manCamps = (camps: readonly AdventureCampPlan[], shore: SettlementPoint) => {
    const excluded: SettlementPoint[] = [];
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const planned = planCampSites(context, camps.length, shore, excluded);
      if (!planned) return null;
      const positions: SettlementPoint[] = [];
      const raised = camps.map((camp, index) =>
        raiseCamp(military, planned.sites[index]!, camp, planned.reachable, positions));
      const short = planned.sites.filter((_site, index) => raised[index]!.length < camps[index]!.troops.length);
      if (!short.length) return { raised, sites: planned.sites };
      for (const id of raised.flat()) military.combat.withdrawOpponent(id);
      excluded.push(...short);
    }
    return null;
  };
  const start = (setup: AdventureSetup) => {
    if (state) return { ok: false as const, reason: "This adventure has already begun" };
    const beach = findAdventureLanding(context);
    if (!beach) return { ok: false as const, reason: "No landing beach on this island" };
    const plan = adventureEnemyPlan(setup.island.difficulty, context.difficulty);
    const raised = manCamps(plan.camps, beach.gangway.shore);
    // Never an instant win: every camp is fully manned or the start fails with nothing raised.
    if (!raised) return { ok: false as const, reason: "No reachable room for every enemy camp" };
    landing.start(beach, setup.troops);
    raiseAdventureDefences(context, military, setup.island, raised.sites, raised.raised, beach.gangway.shore);
    const enemies = new Set(military.soldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0)
      .map(soldier => soldier.actor));
    for (const actor of context.actors) if (enemies.has(actor.uid)) {
      actor.yaw = DMath.atan2(beach.gangway.shore.x - actor.x, beach.gangway.shore.z - actor.z);
    }
    state = { battle: createBattleRecord(setup.troops, context.buildings), campSites: raised.sites.map(site => ({ ...site })), enemies: raised.raised.flat().length,
      island: { ...setup.island }, status: "contested", version: 1 };
    campRevision++; bumpNavigationRevision(context);
    return { ok: true as const };
  };
  const finish = (status: Exclude<AdventureStatus, "contested">) => {
    state!.status = status;
    state!.endedAt = now();
    const resultId = `adventure:${state!.island.id}:${state!.island.seed}`;
    if (status === "won") military.commander.recordMissionResult(resultId);
    else military.commander.recordMissionFailure(resultId);
  };
  const update = () => {
    if (!state) return;
    const structures = new Map(military.combat.doors().map(door => [door.building, door.structure]));
    for (const building of hostileBuildings()) {
      if ((structures.get(building.uid)?.fallen ?? 0) < FORT_REMOVAL_SECONDS) continue;
      military.removeBuilding(building.uid);
      removeSettlementBuilding(context, building);
      context.options.onBuildingDemolished?.(building);
    }
    if (state?.status !== "contested") return;
    watchHostileForts(context, military, hostileBuildings());
    if (!hostileBuildings().length && !soldiersOf(true)) { finish("won"); return; }
    if (!soldiersOf(false)) finish("defeated");
  };
  const save = (): SettlementAdventureSave | undefined => {
    if (!state) return undefined;
    const saved = { ...state, battle: copyBattleRecord(state.battle), campSites: state.campSites?.map(site => ({ ...site })), island: { ...state.island } }, beach = landing.save();
    return beach ? { ...saved, landing: beach } : saved;
  };
  const restore = (saved?: SettlementAdventureSave) => {
    const { battle: _battle, landing: beach, ...rest } = saved ?? {};
    state = saved && { battle: copyBattleRecord(saved.battle), ...rest as Omit<SettlementAdventureSave, "landing">,
      campSites: saved.campSites?.map(site => ({ ...site })), island: { ...saved.island } };
    if (saved) for (const site of hostileBuildings())
      if (site.bandit !== undefined) site.enemyCampEnclosure = "building";
    landing.restore(beach);
    campRevision++; bumpNavigationRevision(context);
    recoverCampOverlaps(context);
  };
  return {
    recordDeath: (type: import("./military-combat-rules").MilitaryTroopType, faction: number) => {
      if (state?.status === "contested") recordBattleDeath(state.battle, type, faction);
    },
    recordArrivals: (troops: readonly EmigratedTroop[]) => {
      if (state?.status === "contested") addBattleTroops(state.battle, troops);
    },
    /** The player commands troops; only scripted enemy defences are placed. */
    allowsBuilding: () => !state,
    /**
     * A completed adventure with no hostile building left: the ruin cleanup loop has nothing to
     * remove, the contested watch/win check is skipped, and the landing ship has no timer of its
     * own (`updateActor` only advances soldiers in landing phases).
     */
    quietSkip: () => !state || (state.status !== "contested" && hostileBuildings().length === 0),
    campRevision: () => campRevision,
    campCount: () => state?.campSites?.length ?? 0,
    campFrames: (): readonly AdventureCampFrame[] => {
      const plots = context.buildings.map(({ depth, width, x, z }) => ({ x, z, width, depth }));
      return (state?.campSites ?? []).map((site, id) => ({ id, ...site,
        theme: state?.island.theme ?? "bandit", ...(plots.length && { defencePlots: plots }) }));
    },
    horseFrames: landing.horseFrames,
    save,
    restore,
    shipFrames: landing.shipFrames,
    shipSites: landing.sites,
    snapshot: () => state && { ...state, hostileBuildings: hostileBuildings().length,
      hostileSoldiers: soldiersOf(true), island: { ...state.island }, landing: landing.snapshot() },
    start,
    update,
    updateActor: landing.updateActor
  };
};
