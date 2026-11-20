import { banditSiteRef, isOpenArcherTower, placedBanditCamp } from "../../render-common/buildings/bandit-camp-plan";
import { GARRISON_CAPACITIES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import type { MapScenario, ScenarioBuilding } from "../world/map-scenario";
import { isMapScenario } from "../world/map-scenario";
import { factionAiErrorMessages } from "../world/scenario-faction-ai-issues";
import { scenarioGarrison, scenarioGarrisonCapacity } from "../world/scenario-garrison";
import { scenarioMapRulesMessages } from "../world/scenario-map-rules";
import { scenarioPatrolRoute } from "../world/scenario-patrol";
import type { WorldData } from "../world/world-data";
import { type AuthoredObjectUids, createAuthoredObjectUids } from "./authored-object-uids";
import { marbleDeposits } from "./colony-marble-deposits";
import { LANDING_HARBOUR_MISSING } from "./constants";
import { type DifficultyLevel, difficultyRank, difficultyScaled } from "./difficulty";
import { buildingStructure } from "./fort-assault-rules";
import { initializeHostileCatapult } from "./hostile-catapult-bootstrap";
import { militaryGroundPath } from "./military-routing";
import { createRoadNetwork } from "./road-network";
import { createScenarioRoadNetwork, inspectScenarioRoads } from "./scenario-road-placement";
import { spawnHostileNear } from "./settlement-colony";
import type { createSettlementMilitary } from "./settlement-military";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import { groundPath } from "./settlement-paths";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

const scratchContext = (world: WorldData): SettlementContext => ({
  options: { world, roads: createRoadNetwork(world) }, actors: [], buildings: [],
  occupied: new Uint8Array(world.cellsX * world.cellsZ), reservations: new Set(),
  nextActor: 0, nextBuilding: 0, settlers: 0, resourceAmounts: new Map(), accumulator: 0,
  scheduling: 0, transfers: []
});
/** Search actual walkable approaches instead of spawning a line through water or a neighbour. */
const defenderSpots = (context: SettlementContext, building: SettlementBuilding, count: number, taken: { x: number; z: number }[] = []) => {
  const spots: { x: number; z: number }[] = [];
  if (!count) return spots;
  for (let radius = 0; radius <= 5; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const point = { x: building.access.x + dx, z: building.access.z + dz };
      if (taken.some(other => DMath.hypot(other.x - point.x, other.z - point.z) < .45) ||
        context.actors.some(actor => actor.visible && DMath.hypot(actor.x - point.x, actor.z - point.z) < .45) ||
        context.options.world.scenario?.units.some(unit => DMath.hypot(unit.x - point.x, unit.z - point.z) < .45) ||
        !isNavigationClear(context, point) || !groundPath(context, building.access, point)) continue;
      spots.push(point);
      if (spots.length === count) return spots;
    }
  }
  return spots;
};
/** Every authored garrison group at the live difficulty (count and tier), never above the camp's capacity. */
const scaledScenarioGarrison = (entry: ScenarioBuilding, level?: DifficultyLevel) => {
  let room = scenarioGarrisonCapacity(entry);
  return scenarioGarrison(entry).flatMap((group) => {
    const count = Math.min(room, difficultyScaled(group.count, "soldiers", level));
    room -= count;
    return count > 0 ? [{ ...group, count, rank: difficultyRank(group.rank, level) }] : [];
  });
};
const reserve = (context: SettlementContext, building: SettlementBuilding) => {
  context.buildings.push(building);
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * context.options.world.cellsX + x] = 1;
};
const authoredBuilding = (context: SettlementContext, entry: ScenarioBuilding) => {
  const building = makeBuilding(context, entry.type, entry.x, entry.z, entry.rotation);
  if (entry.catapult) building.enemyCatapultVariant = entry.catapult.variant;
  if (entry.bandit === undefined) return building;
  Object.assign(building, placedBanditCamp(entry.bandit, entry.x, entry.z, entry.rotation), {
    bandit: banditSiteRef(entry.bandit.code, entry.bandit.layout), enemyCampEnclosure: entry.enclosure,
    hasDoor: !isOpenArcherTower(entry)
  });
  return building;
};
/** Scratch authoring occupancy for advisory space checks; never claims or flattens the real world. */
export const createScenarioInspectionContext = (world: WorldData) => {
  const context = scratchContext(world), scenario = world.scenario;
  if (!scenario || !isMapScenario(scenario, world.cellsX, world.cellsZ)) return context;
  context.playerNation = scenario.nation;
  const definitions: ScenarioBuilding[] = [...scenario.buildings];
  if (scenario.headquarters) definitions.unshift({ ...scenario.headquarters, id: 0, type: 0,
    defenders: 0, faction: 0 });
  for (const entry of definitions) {
    const building = authoredBuilding(context, entry);
    if (placementReason(context, building)) continue;
    Object.assign(building, { construction: 1, militaryFaction: entry.faction });
    reserve(context, building);
  }
  for (const deposit of scenario.marbleDeposits ?? [])
    context.occupied[Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x)] = 1;
  const roads = createScenarioRoadNetwork(context);
  roads.replaceSegments(scenario.roads ?? []);
  context.options.roads = roads;
  return context;
};

/** What every kind needs before Play. A campaign map starts at its landing harbour (no HQ, R4; C7a). */
const missingFoundations = (scenario: MapScenario) => {
  const errors: string[] = [], campaign = scenario.kind === "campaign";
  if (scenario.kind !== "adventure" && !campaign && !scenario.headquarters)
    errors.push("Place one headquarters before Play");
  // Campaign objectives depend on the victory rule; validateCampaignMap checks the targets.
  if (scenario.kind !== "home" && !campaign && !scenario.units.length && !scenario.buildings.length)
    errors.push("Place an enemy unit or building to define the scenario objective");
  if (scenario.kind !== "home" && !campaign && !scenario.landing) errors.push("Place a landing point before Play");
  if (campaign && !scenario.harbourPlot) errors.push(LANDING_HARBOUR_MISSING);
  return errors;
};

/**
 * Placement and reachability proof on scratch occupancy; never clears props or spends IDs. On a campaign map the
 * landing harbour's access is the origin: every enemy unit, patrol and building must be reachable by land from it
 * (review R17).
 */
/** The map rules' and faction AI's own messages when they are what the guard refused, else the generic one. */
const invalidScenarioMessages = (scenario: MapScenario) => {
  const messages = [...scenarioMapRulesMessages(scenario), ...factionAiErrorMessages(scenario, { scope: "shape" })];
  return messages.length ? messages : ["Invalid scenario definition"];
};
export const validateMapScenario = (world: WorldData) => {
  const scenario = world.scenario;
  if (!scenario) return [];
  if (!isMapScenario(scenario, world.cellsX, world.cellsZ)) return invalidScenarioMessages(scenario);
  const errors = [...missingFoundations(scenario), ...factionAiErrorMessages(scenario, world)];
  const context = scratchContext(world);
  const definitions = scenario.buildings.map(entry => ({ ...entry, typeId: entry.type }));
  if (scenario.headquarters) definitions.unshift({ ...scenario.headquarters, id: 0, type: 0, typeId: 0,
    defenders: 0, faction: 0 });
  for (const entry of definitions) {
    const building = authoredBuilding(context, entry);
    const reason = placementReason(context, building);
    if (reason) { errors.push(`${entry.id === 0 ? "Headquarters" : `Building ${entry.id}`}: ${reason}`); continue; }
    if (entry.defenders > scenarioGarrisonCapacity(entry)) errors.push(`Building ${entry.id}: too many defenders`);
    reserve(context, building);
  }
  for (const deposit of scenario.marbleDeposits ?? []) {
    const overlapping = context.buildings.some(building =>
      Math.abs(deposit.x - building.x) < building.width / 2 + .9 &&
      Math.abs(deposit.z - building.z) < building.depth / 2 + .9);
    if (overlapping || !isNavigationClear(context, deposit) ||
      scenario.marbleDeposits!.some(other => other.id < deposit.id &&
        DMath.hypot(other.x - deposit.x, other.z - deposit.z) < 3)) {
      errors.push(`Marble ${deposit.id + 1}: needs clear dry ground outside building plots`);
      continue;
    }
    context.occupied[Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x)] = 1;
  }
  const authoredRoads = createScenarioRoadNetwork(context);
  errors.push(...inspectScenarioRoads(context, scenario.roads ?? []));
  authoredRoads.replaceSegments(scenario.roads ?? []);
  context.options.roads = authoredRoads;
  let harbourAccess: { x: number; z: number } | undefined;
  if (scenario.harbourPlot) {
    const draft = makeBuilding(context, 39, scenario.harbourPlot.x, scenario.harbourPlot.z, scenario.harbourPlot.rotation);
    const reason = placementReason(context, draft);
    harbourAccess = draft.access;
    if (reason) errors.push(`Harbour reservation: ${reason}`);
    else if (scenario.kind !== "campaign" && context.buildings[0] &&
      !groundPath(context, context.buildings[0].access, draft.access))
      errors.push("Harbour reservation: no walking approach from headquarters");
  }
  const origin = scenario.kind === "campaign" ? harbourAccess : scenario.landing ?? context.buildings[0]?.access;
  if (origin) for (const deposit of scenario.marbleDeposits ?? []) {
    const reachable = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].some(([dx, dz]) => {
      const point = { x: deposit.x + dx!, z: deposit.z + dz! };
      return isNavigationClear(context, point) && groundPath(context, origin, point);
    });
    if (!reachable) errors.push(`Marble ${deposit.id + 1}: no reachable quarry approach`);
  }
  if (origin && !isNavigationClear(context, origin)) errors.push("Landing/start approach is not walkable");
  for (const unit of scenario.units) {
    if (!isNavigationClear(context, unit) || (unit.type === "cavalry" && !isMountedNavigationClear(context, unit)))
      errors.push(`Unit ${unit.id}: blocked ground`);
    else if (origin && !militaryGroundPath(context, unit, origin, unit.type === "cavalry"))
      errors.push(`Unit ${unit.id}: unreachable from landing/start`);
    if (scenario.units.some(other => other.id < unit.id && DMath.hypot(other.x - unit.x, other.z - unit.z) < .45))
      errors.push(`Unit ${unit.id}: overlaps another unit`);
  }
  for (const unit of scenario.units) {
    if (!unit.patrol?.length) continue;
    const route = scenarioPatrolRoute(unit);
    for (let index = 0; index < route.length; index++) {
      const start = route[index]!, end = route[(index + 1) % route.length]!;
      if (!isNavigationClear(context, end) || !militaryGroundPath(context, start, end, unit.type === "cavalry"))
        errors.push(`Unit ${unit.id}: patrol link ${index + 1} is blocked or unreachable`);
    }
  }
  if (origin) for (const building of context.buildings) {
    if (!groundPath(context, origin, building.access)) errors.push(`Building ${building.uid}: unreachable doorway`);
  }
  const taken: { x: number; z: number }[] = [];
  for (const entry of scenario.buildings) {
    const building = context.buildings.find(site => site.x === entry.x && site.z === entry.z);
    if (!building) continue;
    const spots = defenderSpots(context, building, entry.defenders, taken); taken.push(...spots);
    if (spots.length < entry.defenders) errors.push(`Building ${entry.id}: insufficient walkable garrison exits`);
  }
  return errors;
};
/** Keeps at most `count` garrison soldiers, in the authored group order. */
const trimGarrison = (groups: ReturnType<typeof scaledScenarioGarrison>, count: number) => {
  let room = count;
  return groups.flatMap((group) => {
    const kept = Math.min(room, group.count);
    room -= kept;
    return kept > 0 ? [{ ...group, count: kept }] : [];
  });
};

/** Spawns an authored building's garrison at the live difficulty; Normal keeps the authored roster. */
/**
 * An authored enemy site that holds no garrison (an enemy HQ, owner Q-BD2, or any other building) still
 * has a door with walls, so it can be destroyed (BD1) and its faction keeps a door as saves require.
 */
const wallAuthoredSite = (
  military: ReturnType<typeof createSettlementMilitary>, building: SettlementBuilding, entry: ScenarioBuilding
) => {
  const walls = buildingStructure(building.typeId);
  if (!walls || !military.combat.registerDoor(building.uid, entry.faction) ||
    !military.combat.fortify(building.uid, walls)) throw new Error(`Authored building ${entry.id}: invalid walls`);
};

const spawnAuthoredGarrison = (
  context: SettlementContext, military: ReturnType<typeof createSettlementMilitary>,
  building: SettlementBuilding, entry: ScenarioBuilding
) => {
  if (GARRISON_CAPACITIES[building.typeId] === undefined) { wallAuthoredSite(military, building, entry); return; }
  let garrison = scaledScenarioGarrison(entry, context.difficulty);
  let defenders = garrison.reduce((sum, group) => sum + group.count, 0);
  const spots = defenderSpots(context, building, defenders);
  if (spots.length !== defenders) {
    if (!context.difficulty || context.difficulty === "normal")
      throw new Error(`Authored building ${entry.id}: blocked garrison exits`);
    // A harder roster beyond the camp's walkable exits fields what fits instead of failing the map.
    garrison = trimGarrison(garrison, spots.length);
    defenders = spots.length;
  }
  const ids: number[] = [];
  for (const group of garrison) for (let index = 0; index < group.count; index++) {
    const id = military.combat.spawnOpponent(spots[ids.length]!, group.type, group.rank, entry.faction);
    if (id === null) throw new Error(`Authored building ${entry.id}: no room for defender ${ids.length + 1}`);
    ids.push(id);
  }
  if (!military.combat.registerGarrison(building.uid, ids, entry.faction))
    throw new Error(`Authored building ${entry.id}: invalid garrison`);
};

/** Spawns every authored field unit (recording its map-file id → actor uid), then the difficulty extras. */
const spawnAuthoredUnits = (
  context: SettlementContext, military: ReturnType<typeof createSettlementMilitary>,
  scenario: NonNullable<WorldData["scenario"]>, objects: AuthoredObjectUids
) => {
  const patrols: { unit: number; actor: number; next: number; wait: number }[] = [];
  for (const unit of scenario.units) {
    const rank = difficultyRank(unit.rank, context.difficulty);
    const id = military.combat.spawnOpponent(unit, unit.type, rank, unit.faction);
    if (id === null) throw new Error(`Authored unit ${unit.id}: blocked spawn`);
    objects.actor.push(unit.id, id);
    const actor = context.actors.find(actor => actor.uid === id);
    if (actor) actor.yaw = unit.heading;
    if (unit.patrol?.length) patrols.push({ unit: unit.id, actor: id, next: 1, wait: 0 });
  }
  const extraCount = difficultyScaled(scenario.units.length, "soldiers", context.difficulty) -
    scenario.units.length;
  for (let index = 0; index < extraCount; index++) {
    const source = scenario.units[index % scenario.units.length]!;
    spawnHostileNear(military, source, source.type, difficultyRank(source.rank, context.difficulty),
      { faction: source.faction });
  }
  return patrols;
};

/**
 * The played map's authored decorations as fixed scenery (owner 2026-11-10): spawned once at a new start,
 * after the authored roads and headquarters; the save keeps the snapshot from then on.
 */
export const spawnMapScenery = (context: SettlementContext) => {
  const decorations = context.options.world.scenario?.decorations;
  if (!decorations?.length || context.options.scenarioDraft) return;
  context.roadDecorations?.spawnScenery(decorations);
};

/** Called once for a new authored map. Loading a game replaces, rather than appends, runtime entities. */
export const initializeMapScenario = (context: SettlementContext,
  military: ReturnType<typeof createSettlementMilitary>) => {
  const scenario = context.options.world.scenario;
  if (!scenario || context.options.scenarioDraft) return;
  if (scenario.roads?.length && !context.options.roads.replaceSegments?.(scenario.roads))
    throw new Error("Authored roads could not initialize the public road graph");
  marbleDeposits(context);
  // Home stays peaceful: enemy units and camps are meaningful only for adventure/colony maps.
  if (scenario.kind === "home") return;
  const sites = scenario.buildings.map(entry => {
    const building = authoredBuilding(context, entry);
    const reason = placementReason(context, building);
    if (reason) throw new Error(`Authored building ${entry.id}: ${reason}`);
    Object.assign(building, { construction: 1, foundationProgress: 1, required: {},
      militaryFaction: entry.faction, status: "Enemy camp" });
    claimBuilding(context, building);
    if (entry.catapult) initializeHostileCatapult(context, building, entry.catapult);
    return { entry, building };
  });
  const objects = createAuthoredObjectUids();
  for (const { building, entry } of sites) objects.building.push(entry.id, building.uid);
  for (const { building, entry } of sites) spawnAuthoredGarrison(context, military, building, entry);
  const patrols = spawnAuthoredUnits(context, military, scenario, objects);
  context.authoredScenario = { patrols, elapsed: 0, claiming: 0, status: "active", rewardPaid: false, pendingCoins: 0,
    sites: context.buildings.filter(site => ownerOf(site) > 0).map(site => site.uid), objects };
};
