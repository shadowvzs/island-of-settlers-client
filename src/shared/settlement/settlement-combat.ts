import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { admitAiOrder } from "../script-world/script-order-guard";
import { emitUnitGone } from "../script-world/script-unit-events";
import { sampleSmooth } from "../world/grid-geometry";
import { CATAPULT_HOME_YAW, CATAPULT_RESUPPLY_ROOF_ROUTE, catapultStockAnchor } from "./catapult-cycle";
import { collapseCatapultWorker } from "./catapult-worker-collapse";
import { prepareCatapultWorkerEvacuation } from "./catapult-worker-evacuation";
import { createGroundHeight } from "./commander/commander-ground";
import { type CommanderLevelEntry, createCommanderLevels } from "./commander/commander-levels";
import { createCommanderProfileSource } from "./commander/commander-profile-source";
import type { DirectorSave } from "./commander/director-types";
import type { MilitaryMoraleSave } from "./commander/military-morale-update";
import type { FactionKnowledge, FactionKnowledgeSave } from "./faction-knowledge";
import { probeAccept } from "./faction-vision-probe";
import type { MilitaryStructure } from "./fort-assault-rules";
import { isMilitaryAiMode, type MilitaryAiMode, type SavedMilitaryAiMode } from "./military-ai-mode";
import { createMilitaryArchery } from "./military-archery";
import { catapultAmmoAllowsRestock } from "./military-catapult-ammo";
import { updateCatapultDefences, updatePlayerFortDefences } from "./military-catapult-defence";
import { detachCatapultPorter, dropCatapultStone } from "./military-catapult-resupply";
import { createCatapultResupplyActors } from "./military-catapult-resupply-actors";
import { createBesiegedIndex, createCivilianThreat } from "./military-civilian-safety";
import { type CivilianTargetSave, createCivilianTargets } from "./military-civilian-targets";
import {
  fightingType, isOrdinaryTroopType, MILITARY_DEATH_SECONDS, type MilitaryCombatant, type MilitaryDeathEffect, type MilitaryDoor,
  militaryHealth, militaryPace, type MilitaryTroopType
} from "./military-combat-rules";
import { createMilitaryCommander } from "./military-commander";
import { createMilitaryDirectControl } from "./military-direct-control";
import { createDirectAwareOrders } from "./military-direct-orders";
import type { MilitaryDirectSave } from "./military-direct-state";
import { createArrivingBlocks, createMarchSettling } from "./military-formation";
import { createMilitaryMarchRoutes } from "./military-long-routes";
import { createMilitaryMelee } from "./military-melee";
import { createMilitaryMountPoints } from "./military-mount-points";
import { createMilitaryMovement } from "./military-movement";
import type { MilitaryArrow } from "./military-projectiles";
import { createMilitaryRiders } from "./military-riders";
import { fortifyEconomyGarrison, fortifyPlayerSite, isShieldedSupportSite } from "./military-siege-sites";
import { createMilitarySpatialGrid, type MilitarySpatialGrid } from "./military-spatial-grid";
import { createMilitarySteering } from "./military-steering";
import { createStructureAssault } from "./military-structure-assault";
import { createMilitaryStuckRecovery } from "./military-stuck";
import { acquireRadius, stanceOf } from "./military-targeting";
import { nationMilitarySpeedFactor } from "./nation-bonuses";
import {
  createCombatCommands, enableEventCourtyard as enableCourtyard, isOpponentSpec, testSkirmishPositions
} from "./settlement-combat-commands";
import {
  type CombatCore, createCombatCasualties, type FieldMemory, type MountCheck, type PendingMarch
} from "./settlement-combat-core";
import { createCombatDirector, updateDirectorPhase } from "./settlement-combat-director";
import { createCombatChase } from "./settlement-combat-chase";
import { createCombatEngagement } from "./settlement-combat-engagement";
import { createCombatField } from "./settlement-combat-field";
import { type MilitaryFieldSave, restoreCombatField, saveCombatField } from "./settlement-combat-field-save";
import {
  createCombatMorale, createTargetingPriorities, grantStrikeGrace, moraleStatesOf, updateMoralePhase
} from "./settlement-combat-morale";
import { createCombatMounting } from "./settlement-combat-mounting";
import { createCombatOrders } from "./settlement-combat-orders";
import { createCombatRallyCancel } from "./settlement-combat-rally";
import { createCombatRouting } from "./settlement-combat-routing";
import { createScriptUnitControl } from "./settlement-combat-script";
import { createCombatShipPassage } from "./settlement-combat-ship-passage";
import { createCombatTargeting } from "./settlement-combat-targeting";
import {
  createArcheryTargetSource, createCombatKnowledge, createCommanderPerception, createCommanderUnitSources,
  refreshActorIndex, updateCommanderPhase
} from "./settlement-combat-tick-inputs";
import { distanceToSegment } from "./settlement-geometry";
import type { SettlementSoldier } from "./settlement-military";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import { countOnDuty } from "./settlement-population";
import { createSettlementSieges, type MilitaryDoorExchange } from "./settlement-siege";
import { stockContact } from "./settlement-stock-transfers";
import { clearWareTransfer } from "./settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import type { AuditedRandom } from "./simulation-random";
import { repairStructure } from "./wall-repair-rules";

/** `civilianDeaths` / `woundedCivilians`: player civilians attacked outside buildings (MIL-ASSAULT). */
export interface MilitaryCombatSave extends CivilianTargetSave {
  arrows: MilitaryArrow[]; doors: MilitaryDoor[]; nextArrow: number;
  directControl?: MilitaryDirectSave;
  /** Removed mode ids are still accepted by validation and load as the shipped mode. */
  aiMode?: SavedMilitaryAiMode;
  movement?: import("./military-movement").MilitaryMovementSave;
  commander?: import("./military-commander").MilitaryCommanderSave;
  exchanges?: MilitaryDoorExchange[];
  pendingMarches?: PendingMarch[];
  /** Battlefield working state (places, holds, velocities, march legs, memories); absent without a battle. */
  field?: MilitaryFieldSave;
  /** A13 phase 3: hit alerts and last known enemies (absent when nobody knows anything). */
  knowledge?: FactionKnowledgeSave;
  /** A14-2: recent falls per faction (absent when none is recent); soldiers' morale is in their field memory. */
  morale?: MilitaryMoraleSave;
  /** A14-4a: the strategic director's forces (absent when no computer faction has one). */
  director?: DirectorSave;
  /** A14-5: the commander levels a map script set, `[faction, level]` ascending (absent when none). */
  commanderLevels?: CommanderLevelEntry[] }

/** A door with its own copy of the walls (saves never share live state). */
const copyDoor = (door: MilitaryDoor): MilitaryDoor =>
  door.structure ? { ...door, structure: { ...door.structure } } : { ...door };

const createCombatResupply = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, buildingStanding: (uid: number) => boolean,
  actorById: (uid: number) => SettlementActor | undefined, doorInCombat: (uid: number) => boolean,
  onWorkerDeath: (effect: MilitaryDeathEffect) => void
) => createCatapultResupplyActors(context, {
  layout: { roofRoute: CATAPULT_RESUPPLY_ROOF_ROUTE, rackStone: catapultStockAnchor },
  isStanding: buildingStanding,
  collapseWorker: site => collapseCatapultWorker(context, site, onWorkerDeath),
  releaseCargo: (site, porter, actor) => {
    if (actor) dropCatapultStone(site, { x: actor.x, y: actor.y, z: actor.z }, porter.kind);
  },
  roofSafe: site => catapultAmmoAllowsRestock(site, Math.abs(DMath.atan2(
    DMath.sin((site.catapultAim ?? CATAPULT_HOME_YAW) - CATAPULT_HOME_YAW),
    DMath.cos((site.catapultAim ?? CATAPULT_HOME_YAW) - CATAPULT_HOME_YAW))) < .002),
  threatened: site => {
    if (doorInCombat(site.uid)) return true;
    const porter = site.catapultSupply?.porter;
    const body = porter && actorById(porter.actor);
    const dropped = site.catapultSupply?.drops?.[porter?.drop ?? -1];
    const pile = dropped ?? stockContact(context, site, "input", "stone",
      Math.max(0, (site.catapultSupply?.ground ?? 0) - 1)).approach;
    // Civilian collection crosses only the front court. Distant siege/archery range does not
    // prohibit normal work behind a defended wall; an occupied doorway or immediate route does.
    const route = [site.doorThreshold, site.workerApproach, site.access, pile];
    if (body?.visible && body.path.length) route.push(body, ...body.path.slice(body.pathIndex));
    for (const soldier of soldiers.values()) {
      if (soldier.combat?.faction === ownerOf(site) || (soldier.combat?.hp ?? 0) <= 0) continue;
      const enemy = actorById(soldier.actor);
      if (!enemy?.visible || !["militaryField", "militarySiege"].includes(enemy.phase)) continue;
      const clearance = MILITARY_PROFILES[soldier.combat!.type].range;
      const immediateReach = Math.min(clearance, MILITARY_PROFILES.cavalry.range);
      for (let index = 1; index < route.length; index++)
        if (distanceToSegment(enemy, route[index - 1]!, route[index]!) < immediateReach) return true;
    }
    return false;
  }
});

const optionalField = (field: MilitaryFieldSave | undefined) => field ? { field } : {};
const optionalMorale = (morale: MilitaryMoraleSave | undefined) => morale ? { morale } : {};
const optionalDirector = (director: DirectorSave | undefined) => director ? { director } : {};
const optionalCommanderLevels = (commanderLevels: CommanderLevelEntry[] | undefined) =>
  commanderLevels ? { commanderLevels } : {};
const optionalKnowledge = (knowledge: FactionKnowledgeSave) =>
  knowledge.alerts.length || knowledge.records.length || knowledge.sites?.length || knowledge.sectors?.length ||
    knowledge.scouting?.length ? { knowledge } : {};

/**
 * Computer soldiers in the field near a point: civilians stay inside or flee (MIL-ASSAULT 2026-11-09). Owner
 * 2026-11-13 (A13 phase 3): only raiders the player knows (its vision layer sees them) count.
 */
export const createFieldCivilianThreat = (grid: MilitarySpatialGrid<SettlementActor>,
  entries: readonly SettlementActor[], factionOf: (uid: number) => number | undefined, knowledge: FactionKnowledge,
  sites: { besieged: (uid: number) => boolean; standing: (uid: number) => boolean }) => {
  const hostile = (body: SettlementActor) => (factionOf(body.uid) ?? 0) > 0 && knowledge.knows(0, body);
  /** The faction whose view `hostileToViewer` answers for (one predicate, no closure per query). */
  let viewer = 0;
  const hostileToViewer = (body: SettlementActor) => {
    const faction = factionOf(body.uid);
    return faction !== undefined && faction !== viewer && knowledge.knows(viewer, body);
  };
  return createCivilianThreat({
    ...sites,
    enemyWithin: (point, radius) =>
      grid.anyWithin(point.x, point.z, radius, probeAccept("civilian.enemyWithin", 0, hostile)),
    factionEnemyWithin: (faction, point, radius) => {
      viewer = faction;
      return grid.anyWithin(point.x, point.z, radius, probeAccept("civilian.factionEnemyWithin", faction,
        hostileToViewer));
    },
    hostilePresent: () => entries.some(probeAccept("civilian.hostilePresent", 0, hostile)),
    nearestEnemy: (point, radius) =>
      grid.nearest(point.x, point.z, radius, probeAccept("civilian.nearestEnemy", 0, hostile))
  });
};

type QueueTargetDeps = Pick<CombatCore, "archery" | "grid" | "inField" | "isKnownEnemyOf" | "knowledge">;

/**
 * Queued attackers fight known enemies nearby; archers shoot exposed post archers their faction knows, leaving
 * doorway duels to melee.
 */
const createQueueTargetCheck = ({ archery, grid, inField, isKnownEnemyOf, knowledge }: QueueTargetDeps) =>
  (body: SettlementActor, state: MilitaryCombatant) => {
    const radius = acquireRadius("siege", fightingType(state)), enemy = isKnownEnemyOf(state.faction);
    const archer = fightingType(state) === "archer";
    if (grid.anyWithin(body.x, body.z, radius, probeAccept("siege.queueTarget", state.faction,
      entry => enemy(entry) && (inField(entry) || archer)))) return true;
    let exposed = false;
    if (archer) archery.forEachExposed(body, radius, state.faction, id => {
      const post = archery.targetBody(id);
      if (post && knowledge.troopKnows(state.faction, post)) exposed = true;
    });
    return exposed;
  };

export const createSettlementCombat = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, random: AuditedRandom
) => {
  const deaths: MilitaryDeathEffect[] = [];
  const doors = new Map<number, MilitaryDoor>();
  const memories = new Map<number, FieldMemory>();
  const pendingMarches = new Map<number, PendingMarch>();
  const { cellsX, cellsZ } = context.options.world;
  /** Field soldiers and visible door duellists of every side, rebuilt each tick. */
  const grid = createMilitarySpatialGrid<SettlementActor>(cellsX, cellsZ);
  const gridEntries: SettlementActor[] = [], archeryTargets = createArcheryTargetSource();
  const actorIndex = new Map<number, SettlementActor>();
  const actorById = (id: number) => actorIndex.get(id) ?? context.actors.find(actor => actor.uid === id);
  const factionOf = (id: number) => soldiers.get(id)?.combat?.faction;
  const memoryOf = (id: number) => {
    let memory = memories.get(id);
    if (!memory) { memory = { seekTime: 0, struck: false }; memories.set(id, memory); }
    return memory;
  };
  const initialize = (soldier: SettlementSoldier) => soldier.combat ??= {
    type: "shield", faction: 0, hp: militaryHealth("shield", soldier.rank), cooldown: 0
  };
  /** A soldier standing in the open field (a valid melee target and grid member). */
  const inField = (body: SettlementActor | undefined) =>
    body?.phase === "militaryField" && body.visible && !soldiers.get(body.uid)?.combat?.towerFall;
  const isEnemyOf = (faction: number) => (body: SettlementActor) => {
    const other = factionOf(body.uid);
    return other !== undefined && other !== faction && soldiers.has(body.uid);
  };
  const { isKnownEnemyOf, knowledge, nextTick } = createCombatKnowledge(context, soldiers, actorById, isEnemyOf);
  const steering = createMilitarySteering(context, {
    // Only a comrade heading for the door fight asks; a waiting queue would otherwise wall the door off.
    canMakeWay: (other, actor) => {
      const state = soldiers.get(other.uid)?.combat;
      // The door fighters and the besieger going ahead to bash the door pass through the waiting queue.
      if (actor.phase !== "militarySiege" && soldiers.get(actor.uid)?.combat?.siege === undefined) return false;
      if (!state || other.phase !== "militaryField" || state.faction !== factionOf(actor.uid) ||
        other.pathIndex < other.path.length) return false;
      return !state.attackTime && state.target === undefined && !sieges.atDoor(other.uid);
    },
    foeOf: actor => soldiers.get(actor.uid)?.combat?.target, grid,
    paceOf: actor => {
      const state = soldiers.get(actor.uid)?.combat;
      if (!state) return .9;
      const factor = state.faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1;
      return militaryPace(state, actor, actor.phase === "militaryField", factor) * directControl.speedShare(actor.uid);
    }
  });
  const movement = createMilitaryMovement(context, {
    stateOf: id => soldiers.get(id)?.combat
  });
  const commanderSources = createCommanderUnitSources(gridEntries, soldiers, memoryOf, () => core,
    uid => sieges.isDefender(uid), uid => resupply.owns(uid), uid => directControl.owns(uid));
  const commanderLevels = context.commanderLevels = createCommanderLevels();
  const commanderProfile = createCommanderProfileSource(context);
  const commanderPerception = createCommanderPerception(knowledge, faction => commanderProfile(faction).reactionTicks);
  const commander = createMilitaryCommander({ cellsX, cellsZ, factions: commanderSources.factions,
    units: commanderSources.units,
    // Squad decisions act at once, as the restored commander was tuned: queued routes would freeze
    // its soldiers mid-fight until planned.
    perceive: commanderPerception,
    command: (ids, point, faction, order) =>
      orders.march(ids, point, faction, order, false, false).length > 0,
    profile: commanderProfile, isClear: point => isNavigationClear(context, point),
    heightAt: createGroundHeight(context), knowsByAlertOnly: knowledge.knowsByAlertOnly,
    setFocus: (members, focus) => { for (const { uid } of members) memoryOf(uid).focus = focus; },
    setSquad: (members, squad) => { for (const { uid } of members) memoryOf(uid).squad = squad; },
    strikeBegins: members => grantStrikeGrace(members, memoryOf, targeting.rescoreTick()) });
  /** Takes a soldier (and its horse) out of the world; `kill` adds the fall, a withdrawal does not. */
  const removeSoldier = (soldier: SettlementSoldier, actor: SettlementActor) => {
    directControl.forget(actor.uid);
    const supplySite = context.buildings.find(site => site.catapultSupply?.porter?.actor === actor.uid);
    if (supplySite) resupply.release(supplySite, actor);
    actor.visible = false; actor.phase = "militaryDead";
    if (soldier.combat?.mount !== undefined) {
      const horse = actorById(soldier.combat.mount);
      if (horse) {
        horse.visible = false; horse.phase = "horseDead";
        context.actors.splice(context.actors.indexOf(horse), 1); actorIndex.delete(horse.uid);
      }
    }
    soldiers.delete(soldier.actor); forgetField(actor.uid);
    context.actors.splice(context.actors.indexOf(actor), 1);
    if ((soldier.combat?.faction ?? 0) === 0) countOnDuty(context, -1);
    actorIndex.delete(actor.uid); sieges.onDeath(actor.uid); assault.forget(actor.uid);
  };
  /** Drops the field bookkeeping of a soldier that leaves the field (death, withdrawal, garrison). */
  const forgetField = (uid: number) => {
    marches.forget(uid); settling.forget(uid); arriving.leave(uid); stuck.forget(uid); memories.delete(uid);
    riders.forget(uid); steering.forget(uid); melee.forget(uid); movement.leave(uid); mountChecks.delete(uid);
  };
  const { fell, hit } = createCombatCasualties({
    actorById, context, deaths, grid, inField, initialize, knowledge, memoryOf, random, removeSoldier, soldiers,
    defenceFactor: (attacker, defender) => directControl.defenceFactor(attacker, defender),
    recordFall: (faction, x, z) => morale.recordFall(faction, x, z)
  });
  const buildingStanding = (uid: number) => doors.get(uid)?.structure?.hp !== 0;
  const resupply = createCombatResupply(context, soldiers, buildingStanding, actorById, uid => sieges.inCombat(uid),
    death => { deaths.push(death); actorIndex.delete(death.id); });
  const civilians = createCivilianTargets(context, actorById, uid => soldiers.has(uid), death => {
    deaths.push(death); actorIndex.delete(death.id);
  });
  // Arrows can hit civilians outside buildings; the civilians module arms a computer archer's draw at them.
  const archery = createMilitaryArchery(context, soldiers, random, actorById, buildingStanding, civilians);
  const besiegedSites = createBesiegedIndex(soldiers);
  const civilianThreat = createFieldCivilianThreat(grid, gridEntries, factionOf, knowledge,
    { besieged: besiegedSites.besieged, standing: buildingStanding });
  context.civilianThreat = civilianThreat.threat;
  const melee = createMilitaryMelee(context, soldiers, actorById);
  const hasQueueTarget = createQueueTargetCheck({ archery, grid, inField, isKnownEnemyOf, knowledge });
  const sieges = createSettlementSieges(context, soldiers, doors, hit, random, {
    actorById, engaged: (body, state) => state.target !== undefined || hasQueueTarget(body, state),
    heldSeconds: uid => steering.heldSeconds(uid), steer: (body, dt) => steering.steer(body, dt)
  });
  const mounts = createMilitaryMountPoints(context), stuck = createMilitaryStuckRecovery(context);
  const marches = createMilitaryMarchRoutes(context), settling = createMarchSettling();
  const arriving = createArrivingBlocks();
  const mountChecks = new Map<number, MountCheck>();
  const core: CombatCore = {
    actorById, archery, arriving, context, doors, factionOf, grid, hit, inField, initialize, isEnemyOf,
    isKnownEnemyOf, knowledge, marches, melee, memories, memoryOf, mountChecks, mounts, movement, pendingMarches,
    random, settling, sieges, soldiers, steering, stuck
  };
  const mounting = createCombatMounting(core);
  const routing = createCombatRouting(core, (uids, destination) => orders.regroup(uids, destination));
  const targeting = createCombatTargeting(core, createTargetingPriorities(context));
  const { plan, stand, walk } = routing;
  const assault = createStructureAssault(context, {
    actorById, doors, fireAtWall: archery.fireAtWall, plan: (actor, state, point) => { plan(actor, state, point); },
    random, soldiers, stand, walk
  });
  const riders = createMilitaryRiders(context, {
    actorById, hasDoorSlot: sieges.hasDoorSlot, soldiers,
    plan: (actor, state, point) => { plan(actor, state, point); }, stand, walk
  });
  const engagement = createCombatEngagement(core, routing);
  const orders = createCombatOrders(core, { mounting, riders });
  const directControl = createMilitaryDirectControl(core, routing, engagement, orders.march);
  context.commanderControl = directControl;
  const morale = createCombatMorale(core, targeting.rescoreTick, orders, directControl.owns);
  const chase = createCombatChase(core, { arrive: routing.arrive, strikeBack: targeting.strikeBackTarget });
  const field = createCombatField(core, { assault, chase, civilians, engagement, mounting,
    returnHome: ids => commands.returnHome(ids), riders, routing, targeting });
  const commands = createCombatCommands(core, {
    indexActor: actor => { actorIndex.set(actor.uid, actor); }, orders, riders
  });
  const { besiege } = commands;
  /** Computer soldiers besiege a building (a colony counterattack, a director strike). */
  const siegeOpponent = (ids: readonly number[], uid: number, faction: number) => {
    if (!Number.isSafeInteger(faction) || faction <= 0) return false;
    const site = context.buildingByUid?.get(uid) ?? context.buildings.find(building => building.uid === uid);
    // A player's own military building takes its walls on the first assault (MIL-ASSAULT); an
    // Academy or Lodge shielded by a nearby garrison building is refused (owner 2026-11-09).
    if (site && isShieldedSupportSite(site, context.buildings, doors)) return false;
    if (site) fortifyPlayerSite(site, doors, context.buildings);
    return besiege(admitAiOrder(context, ids), uid, faction);
  };
  /** A computer field soldier back at its own garrisoned building goes in again (returning raiders). */
  const rejoinGarrison = (id: number, uid: number) => {
    if (!sieges.rejoinGarrison(id, uid)) return false;
    forgetField(id);
    return true;
  };
  const director = createCombatDirector(core, { perceive: commanderPerception, rejoin: rejoinGarrison,
    siege: siegeOpponent, units: commanderSources.units,
    // Strategic marches are queued like any opponent order (their planning is spread over ticks).
    march: (ids, point, faction, mode) => orders.command(ids, point, faction, mode) });
  const spawnPlayer = (point: SettlementPoint, type: MilitaryTroopType, rank = 0) => {
    if (!isOrdinaryTroopType(type) || !Number.isInteger(rank) || rank < 0 || rank > MAX_SOLDIER_RANK ||
      !isNavigationClear(context, point) ||
      context.actors.some(actor => actor.visible && DMath.hypot(actor.x - point.x, actor.z - point.z) < .38))
      return null;
    const y = sampleSmooth(context.options.world, context.options.world.heights, point.x, point.z);
    const uid = commands.addOpponent({ ...point, y }, type, rank, 0, "militaryField");
    memoryOf(uid).anchor = { x: point.x, z: point.z };
    return uid;
  };
  const spawnOpponent = (point: SettlementPoint, type: MilitaryTroopType, rank = 0, faction = 1) => {
    if (!isOpponentSpec(type, rank, faction) || !isNavigationClear(context, point) ||
      (type === "cavalry" && !isMountedNavigationClear(context, point)) ||
      context.actors.some(actor => actor.visible && DMath.hypot(actor.x - point.x, actor.z - point.z) < .38))
      return null;
    const y = sampleSmooth(context.options.world, context.options.world.heights, point.x, point.z);
    const uid = commands.addOpponent({ ...point, y }, type, rank, faction, "militaryField");
    // Its camp: an unordered computer soldier engages near here and returns.
    memoryOf(uid).anchor = { x: point.x, z: point.z };
    return uid;
  };
  const directAware = createDirectAwareOrders(orders, directControl, memoryOf, context, targeting.rescoreTick);
  const scriptUnits = createScriptUnitControl({
    core, fell, forgetField, removeSoldier,
    march: (ids, point, faction, mode) => faction === 0 ? directAware.march(ids, point, mode)
      : orders.march(ids, point, faction, mode, false),
    spawn: (point, type, rank, faction) => faction === 0 ? spawnPlayer(point, type, rank)
      : spawnOpponent(point, type, rank, faction)
  });
  const fieldParts = { assault, core, riders };
  const enableEventCourtyard = (uid: number, wallHp?: number) => enableCourtyard(context, doors, uid, wallHp);
  /** Sorts this tick's field soldiers and door duellists into the grid and the melee claims on each foe. */
  const rebuildGrid = () => {
    gridEntries.length = 0;
    for (const soldier of soldiers.values()) {
      const body = actorById(soldier.actor);
      if (!soldier.combat || soldier.combat.towerFall || !body?.visible ||
        !["militaryField", "militarySiege"].includes(body.phase)) continue;
      gridEntries.push(body);
    }
    grid.rebuild(gridEntries);
    melee.rebuild(gridEntries);
  };
  const update = (dt: number) => {
    nextTick();
    routing.beginTick(); targeting.beginTick(); mounts.update(dt); stuck.beginTick(); steering.beginTick();
    refreshActorIndex(context.actors, actorIndex);
    updateCatapultDefences(context, soldiers, doors, besiege, actorById);
    updatePlayerFortDefences(context, soldiers, doors, besiege, actorById);
    orders.planQueuedMarch();
    sieges.update(dt);
    civilians.update();
    resupply.update(dt);
    for (let index = deaths.length - 1; index >= 0; index--) {
      deaths[index]!.age += dt;
      if (deaths[index]!.age >= MILITARY_DEATH_SECONDS) deaths.splice(index, 1);
    }
    rebuildGrid();
    civilianThreat.beginTick(); besiegedSites.beginTick();
    updateMoralePhase(morale, gridEntries);
    movement.update(dt);
    directControl.update(dt);
    if (!context.options.withoutMilitaryCommander) {
      updateDirectorPhase(director);
      updateCommanderPhase(commander, dt);
    }
    assault.tick(dt);
    archery.update(dt, archeryTargets(gridEntries, sieges.isDefender), hit, assault.arrowStopped);
  };
  return {
    /** The indexed actor lookup (the Shift queue reads its members' bodies through it). */
    actorById,
    /** A large order's member still waiting in a building for its paced turn to set out. */
    marchPending: (uid: number) => pendingMarches.has(uid),
    aiMode: movement.mode,
    /** targetMilitary: the target check and the lock of the soldiers that accepted its attack order. */
    chase: { lock: chase.lock, refusal: chase.refusal },
    directControl,
    /** Only the shipped mode is selectable; removed mode ids are refused. */
    setAiMode: (mode: MilitaryAiMode) => isMilitaryAiMode(mode),
    aiDebug: () => ({ ...movement.debug(), commander: commander.debug(), morale: moraleStatesOf(memories) }),
    prepareLandingDeparture: mounting.prepareLedDeparture,
    update, updateActor: (actor: SettlementActor, dt: number) =>
      resupply.updateActor(actor) || field.updateActor(actor, dt),
    /** Quiet-island skip: with no soldiers the combat layer advances only its movement clock. */
    advanceQuiet: (dt: number) => movement.advanceClock(dt),
    /** Quiet-island skip guard: no projectiles, door fights or queued marches. */
    quietSkip: () => !directControl.state().lease && !directControl.state().horse &&
      !context.buildings.some(site => site.typeId === 16 && site.worker !== undefined &&
      ((site.catapultSupply?.ground ?? 0) > 0 || site.catapultSupply?.drops?.length || site.catapultSupply?.porter)) &&
      archery.save().arrows.length === 0 && doors.size === 0 && sieges.save().length === 0 && !civilians.size() &&
      ![...pendingMarches.values()].some(job => soldiers.has(job.uid)) && director.idle(),
    ...directAware,
    /** Authored patrols yield to combat, existing marches and every garrison/siege assignment. */
    patrolOpponent: commands.patrolOpponent,
    registerGarrison: (...args: Parameters<typeof sieges.registerGarrison>) => {
      const registered = sieges.registerGarrison(...args);
      if (registered) enableEventCourtyard(args[0]);
      return registered;
    },
    enableEventCourtyard,
    removeSiegeBuilding: (uid: number) => {
      const site = context.buildings.find(building => building.uid === uid);
      if (site) {
        const porter = site.catapultSupply?.porter, actor = porter && actorById(porter.actor);
        if (actor) {
          prepareCatapultWorkerEvacuation(site, actor);
          clearWareTransfer(actor); actor.stockBuilding = undefined;
        }
        // The real employee keeps custody until physically reaching storage after its saved exit.
        detachCatapultPorter(site);
      }
      assault.removeBuilding(uid); sieges.removeBuilding(uid);
    },
    select: (ids: readonly number[], type?: MilitaryTroopType) => {
      const selected = new Set(ids);
      for (const soldier of soldiers.values()) {
        const state = initialize(soldier);
        state.selected = state.faction === 0 && (type ? state.type === type : selected.has(soldier.actor));
      }
    },
    registerDoor: (uid: number, faction: number, hp = 200) => {
      if (!context.buildings.some(building => building.uid === uid && building.construction === 1 &&
        (building.militaryFaction === undefined || building.militaryFaction === faction)) ||
        !Number.isSafeInteger(faction) || faction < 0 || !Number.isFinite(hp) || hp <= 0) return false;
      doors.set(uid, { building: uid, faction, hp, maximum: hp });
      enableEventCourtyard(uid);
      return true;
    },
    siege: (ids: readonly number[], uid: number, accepted?: number[]) => besiege(ids, uid, 0, accepted),
    /** A computer economy's garrison building takes its owner's door and walls (EAI2b re-garrison). */
    fortifyEconomyGarrison: (site: SettlementBuilding) => fortifyEconomyGarrison(site, doors),
    /** EAI2d: the walls on `faction`'s own door of building `uid` (read-only), if it has any. */
    factionWalls: (uid: number, faction: number): Readonly<MilitaryStructure> | undefined => {
      const door = doors.get(uid);
      return door?.faction === faction ? door.structure : undefined;
    },
    /** EAI2d wall repair: standing walls regain up to `amount` HP (never above their maximum); the HP gained. */
    repairWalls: (uid: number, amount: number) => repairStructure(doors.get(uid)?.structure, amount),
    /** Gives an enemy building walls that are attacked instead of captured (colony saves before 2026-10-13). */
    fortify: (uid: number, structure: MilitaryStructure) => {
      const door = doors.get(uid);
      if (!door || door.structure || door.faction === 0) return false;
      door.structure = { ...structure };
      return true;
    },
    siegeOpponent,
    destroyBuilding: assault.destroy,
    damageBuilding: assault.damageWalls,
    /** Development tool: one ordinary friendly field soldier at the exact clear click point. */
    spawnPlayer,
    testSkirmish: () => testSkirmishPositions(core),
    /** Scenario-authoring hook; never consumes or fabricates the player's finite population. */
    spawnOpponent,
    /** The map script's soldier actions (TRG5a). */
    scriptUnits,
    /** A computer foot soldier standing on a ship's deck (`phase`: the landing's aboard phase). */
    spawnOpponentAboard: (deck: SettlementPoint & { y: number }, type: Exclude<MilitaryTroopType, "cavalry">,
      rank: number, faction: number, phase: string) =>
      isOpponentSpec(type, rank, faction) ? commands.addOpponent(deck, type, rank, faction, phase) : null,
    /** A computer soldier back inside its own camp leaves the field without a death. */
    withdrawOpponent: (id: number) => {
      const soldier = soldiers.get(id), actor = actorById(id);
      if (!soldier || !actor || (soldier.combat?.faction ?? 0) === 0 || actor.phase !== "militaryField") return false;
      if (context.script) emitUnitGone(context, actor, "despawned");
      removeSoldier(soldier, actor);
      return true;
    },
    rejoinGarrison,
    /** In a doorway fight: attacker, defender or flank helper. */
    atDoor: (uid: number) => sieges.atDoor(uid),
    /** Whether computer field soldier `uid` sees a civilian it would hunt (the hunt's radius and leash). */
    civilianInReach: (uid: number) => {
      const state = soldiers.get(uid)?.combat, body = actorById(uid);
      if (!state || !body || state.faction <= 0) return false;
      return civilians.inReach(body, state, { anchor: memories.get(uid)?.anchor, stance: stanceOf(state, true) });
    },
    admitPlayer: commands.admitPlayer,
    returnHome: commands.returnHome,
    ...createCombatShipPassage(core, forgetField),
    /** The rally banner is cancelled: soldiers still bound for it give up (queued, leaving, marching). */
    cancelRally: createCombatRallyCancel(core, commands.returnHome),
    /** Called once a load is complete: loaded march routes take the island's connectivity revision. */
    afterLoad: () => marches.adoptLoadedRevision(),
    /** Riderless horses waiting beside their dismounted riders. */
    waitingHorses: riders.waitingHorses,
    stuckMetrics: stuck.metrics,
    pendingOrderCount: () => pendingMarches.size,
    arrows: archery.arrows,
    deaths: () => deaths,
    doors: () => [...doors.values()],
    /** A live doorway exchange or shot from/at the walls ends resting recovery. */
    buildingStanding,
    buildingInCombat: (uid: number) => !buildingStanding(uid) || sieges.inCombat(uid) ||
      archery.arrows().some(arrow => arrow.building === uid || arrow.wall === uid),
    save: (): MilitaryCombatSave => ({ ...archery.save(), aiMode: movement.mode(),
      movement: movement.save(), commander: commander.save(), directControl: directControl.save(),
      doors: [...doors.values()].map(copyDoor), exchanges: sieges.save(), ...civilians.save(),
      pendingMarches: structuredClone([...pendingMarches.values()].filter(job => soldiers.has(job.uid))),
      ...optionalField(saveCombatField(fieldParts)), ...optionalKnowledge(knowledge.save()),
      ...optionalMorale(morale.save()), ...optionalDirector(director.save()),
      ...optionalCommanderLevels(commanderLevels.save()) }),
    restore: (saved?: MilitaryCombatSave) => {
      archery.restore(saved);
      pendingMarches.clear();
      for (const job of saved?.pendingMarches ?? []) {
        if (soldiers.has(job.uid)) pendingMarches.set(job.uid, structuredClone(job));
      }
      doors.clear(); deaths.length = 0; movement.clear(); commander.clear();
      // A missing or removed saved mode loads as the shipped mode; movement state is restored after.
      movement.restore(saved?.movement); commander.restore(saved?.commander);
      directControl.restore(saved?.directControl);
      actorIndex.clear();
      sieges.restore(saved?.exchanges);
      restoreCombatField(fieldParts, saved?.field);
      civilians.restore(saved);
      knowledge.restore(saved?.knowledge);
      director.restore(saved?.director);
      commanderLevels.restore(saved?.commanderLevels);
      morale.restore(saved?.morale);
      for (const door of saved?.doors ?? []) doors.set(door.building, copyDoor(door));
    }
  };
};
