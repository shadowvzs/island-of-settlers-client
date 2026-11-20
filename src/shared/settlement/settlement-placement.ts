import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../render-common/buildings/building-grid-metrics";
import { getPlacedBuildingSignpost } from "../../render-common/buildings/building-road-signpost";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { DMath } from "../math/deterministic-math";
import { emitConstructionPlaced } from "../script-world/script-building-events";
import { removePropsAt } from "../world/editing/prop-removal";
import { sampleSmooth } from "../world/grid-geometry";
import type { MapScenario } from "../world/map-scenario";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { BLOCKING, BUILD, ORE, PROP_REMOVED, SLOPE, type WorldData } from "../world/world-data";
import { BuildingType, HARBOUR_TYPE_ID } from "./building-type-ids";
import { getConstructionCost } from "./construction-costs";
import { boatJettyPlacementReason } from "./harbour-boat-reservations";
import { entranceClearancePlacementReason } from "./settlement-building-entrance-clearance";
import { indexBuilding } from "./settlement-building-index";
import { clearEntranceRoadProps, entranceRoadCells } from "./settlement-entrance-road-clearance";
import { levelBuildingFoundation } from "./settlement-foundation";
import { beginTerrainChange, finishFoundationChange } from "./settlement-foundation-changes";
import { harbourShoreRotation, rotationTowards } from "./settlement-harbour-facing";
import { harbourPlacementReason } from "./settlement-harbour-placement";
import { bumpNavigationRevision } from "./settlement-reservations";
import { roadStripPlacementReason } from "./settlement-road-strip-placement";
import { isBuiltCell, ruinPlacementReason } from "./settlement-ruins";
import { rotorPlacementReason } from "./settlement-rotor-clearance";
import { createSeaMask } from "./settlement-sea-navigation";
import { shipyardPlacementReason } from "./settlement-shipyard-placement";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export const constructionCost = (typeId: number, nation?: WorkerNation) =>
  ({ ...getConstructionCost(typeId, nation) });

const signpostBounds = (building: SettlementBuilding) => {
  const { post } = getPlacedBuildingSignpost(building.typeId, building.x, building.z, building.rotation);
  // Reserve the actual signboard and stake with a small foundation clearance, not its access cell.
  const halfWidth = building.rotation % 2 ? 0.07 : 0.22;
  const halfDepth = building.rotation % 2 ? 0.22 : 0.07;
  return { left: post.x - halfWidth, right: post.x + halfWidth,
    top: post.z - halfDepth, bottom: post.z + halfDepth };
};

const overlaps = (
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number }
) => first.left < second.right && first.right > second.left &&
  first.top < second.bottom && first.bottom > second.top;

const plotBounds = (building: SettlementBuilding) => ({
  left: building.x - building.width / 2, right: building.x + building.width / 2,
  top: building.z - building.depth / 2, bottom: building.z + building.depth / 2
});

const signpostPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  const tower = isOpenArcherTower(building);
  const plot = plotBounds(building), post = signpostBounds(building);
  for (const existing of context.buildings) {
    const existingPost = signpostBounds(existing);
    if (!isOpenArcherTower(existing) && overlaps(plot, existingPost)) return "Plot obstructs an existing building signpost";
    if (!tower && overlaps(post, plotBounds(existing))) return "Building signpost overlaps an existing plot";
    if (!tower && !isOpenArcherTower(existing) && overlaps(post, existingPost)) return "Building signposts overlap";
  }
  if (tower) return null;
  const { world } = context.options;
  if (post.left < 0 || post.top < 0 || post.right >= world.cellsX || post.bottom >= world.cellsZ)
    return "Building signpost leaves the island grid";
  for (let z = Math.floor(post.top); z <= Math.floor(post.bottom); z++)
    for (let x = Math.floor(post.left); x <= Math.floor(post.right); x++) {
      const cell = z * world.cellsX + x;
      if (world.blocking[cell] === BLOCKING.water || world.blocking[cell] === BLOCKING.cliff ||
        world.slopeClass?.[cell] === SLOPE.cliff)
        return "Building signpost requires solid passable ground";
    }
  return null;
};
/** `nation`: the construction cost's nation (the owner's economy, EAI1a B3); the player's by default. */
export const makeBuilding = (
  context: SettlementContext, typeId: number, x: number, z: number, rotation = 0, nation = context.playerNation
): SettlementBuilding => {
  const definition = getBuildingDefinition(typeId);
  const turns = ((Math.round(rotation) % 4) + 4) % 4;
  const [baseWidth, baseDepth] = definition.gridFootprint;
  const width = turns % 2 ? baseDepth : baseWidth;
  const depth = turns % 2 ? baseWidth : baseDepth;
  const logistics = getPlacedBuildingLogistics(typeId, x, z, turns);
  return {
    uid: context.nextBuilding++, typeId, x, z, rotation: turns, width, depth,
    y: sampleSmooth(context.options.world, context.options.world.heights, x, z),
    hasDoor: logistics.hasDoor, access: logistics.road, workerApproach: logistics.workerApproach, doorThreshold: logistics.doorThreshold,
    construction: 0, working: false, door: 0, status: "Waiting for road and supplies",
    input: {}, output: {}, inventory: {}, incoming: {},
    required: constructionCost(typeId, nation ?? "roman"),
    accepts: {}, selected: false, cycle: 0
  };
};
/** The ore a mine type (10-13) digs. */
export const requiredMineOre = (typeId: number) => [ORE.granite, ORE.coal, ORE.iron, ORE.gold][typeId - 10];
const MINE_TYPES: ReadonlySet<number> = new Set([
  BuildingType.GraniteMine, BuildingType.CoalMine, BuildingType.IronMine, BuildingType.GoldMine
]);
export const isMineType = (typeId: number) => MINE_TYPES.has(typeId);
/** Why one plot cell cannot carry the foundation (water, cliff, ground class or slope), or null. */
export const foundationCellReason = (
  world: Pick<WorldData, "blocking" | "buildCap" | "buildClass" | "slopeClass">, cell: number, mine: boolean
) => {
  if (world.blocking[cell] === BLOCKING.water || world.blocking[cell] === BLOCKING.cliff ||
    world.slopeClass?.[cell] === SLOPE.cliff) return "Foundation is not buildable";
  const ground = world.buildCap?.[cell] ?? world.buildClass[cell]!;
  if (mine ? ground < BUILD.flag : ground < BUILD.small || ground > BUILD.large)
    return mine ? "A mine requires usable mountain ground" : "Foundation is not buildable";
  if (!mine && (world.slopeClass?.[cell] ?? 0) > SLOPE.gentle) return "Foundation is too steep";
  return null;
};
export interface PlacementReasonOptions {
  /**
   * Skip the harbour launch/dock search. An expedition site was already validated when its target
   * was offered; re-running the full shore/dock search during landing creates a long tick.
   */
  skipHarbourLaunch?: boolean;
}
export const placementReason = (context: SettlementContext, building: SettlementBuilding,
  options: PlacementReasonOptions = {}) => {
  const { world } = context.options;
  const left = building.x - building.width / 2;
  const top = building.z - building.depth / 2;
  if (!Number.isInteger(left) || !Number.isInteger(top)) return "Snap the plot to the cell grid";
  if (left < 0 || top < 0 || left + building.width >= world.cellsX || top + building.depth >= world.cellsZ)
    return "Plot leaves the island grid";
  if (context.roadDecorations?.buildingPlacementClear(building) === false)
    return "Keep the placed road decoration clear or pick it up first";
  const jettyReason = boatJettyPlacementReason(context, building);
  if (jettyReason) return jettyReason;
  const signpostReason = signpostPlacementReason(context, building);
  if (signpostReason) return signpostReason;
  const rotorReason = rotorPlacementReason(context, building);
  if (rotorReason) return rotorReason;
  const entranceReason = entranceClearancePlacementReason(context, building);
  if (entranceReason) return entranceReason;
  const stripReason = roadStripPlacementReason(context, building);
  if (stripReason) return stripReason;
  // Field sites remain the farm's sowable plots even while bare stubble; covering one silently
  // shrinks its work area and can leave the farmer waiting forever for a clear sowing plot.
  if (context.fieldCycles?.snapshot().some((site) =>
    site.x + 0.48 > left && site.x - 0.48 < left + building.width &&
    site.z + 0.48 > top && site.z - 0.48 < top + building.depth))
    return "Plot overlaps an active crop or charcoal site";
  const ruinReason = ruinPlacementReason(context, building);
  if (ruinReason) return ruinReason;
  const mine = isMineType(building.typeId);
  let hasDeposit = false;
  let lowest = Infinity, highest = -Infinity;
  for (let z = top; z < top + building.depth; z++) {
    for (let x = left; x < left + building.width; x++) {
      const cell = z * world.cellsX + x;
      if (context.occupied[cell]) return "Plot overlaps a building or its entrance";
      const foundationReason = foundationCellReason(world, cell, mine);
      if (foundationReason) return foundationReason;
      if (mine) {
        const ore = requiredMineOre(building.typeId);
        const zone = world.mineZones.find((entry) => entry.id === world.mineZone[cell]);
        hasDeposit ||= zone?.ore === ore && world.oreAmount[cell]! > 0;
      }
    }
  }
  if (mine && !hasDeposit) return "The required mineral is absent";
  for (let z = top; z <= top + building.depth; z++)
    for (let x = left; x <= left + building.width; x++) {
      const height = world.heights[z * (world.cellsX + 1) + x]!;
      lowest = Math.min(lowest, height); highest = Math.max(highest, height);
    }
  if (highest - lowest > (mine ? 1 : building.width * 0.2 + 0.1)) return "Foundation is too steep";
  const access = Math.floor(building.access.z) * world.cellsX + Math.floor(building.access.x);
  if (!world.walkCost[access] || world.blocking[access] !== 0 || context.occupied[access]) return "Entrance must have clear passable ground";
  if (entranceRoadCells(context, building).some(cell =>
    world.blocking[cell] === BLOCKING.water || world.blocking[cell] === BLOCKING.cliff ||
    isBuiltCell(context.occupied[cell])))
    return "Entrance road needs room for its full width";
  const harbourReason = options.skipHarbourLaunch ? null : harbourPlacementReason(context, building);
  return harbourReason ?? shipyardPlacementReason(context, building) ?? null;
};
/** Foundation's three-vertex apron plus refresh neighbours, and the actual authored door lane. */
const beginClaimTerrainChange = (context: SettlementContext, building: SettlementBuilding) => {
  const { world } = context.options;
  const bounds = { minX: Math.max(0, Math.floor(building.x - building.width / 2 - 4)),
    minZ: Math.max(0, Math.floor(building.z - building.depth / 2 - 4)),
    maxX: Math.min(world.cellsX, Math.ceil(building.x + building.width / 2 + 4)),
    maxZ: Math.min(world.cellsZ, Math.ceil(building.z + building.depth / 2 + 4)) };
  // Entrance prop removal changes blocking at these cells even for a custom offset access.
  for (const cell of entranceRoadCells(context, building)) {
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return beginTerrainChange(world, bounds);
};

export const claimBuilding = (context: SettlementContext, building: SettlementBuilding) => {
  const { world } = context.options;
  const change = beginClaimTerrainChange(context, building);
  const { cellsX } = world;
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  const removed: number[] = [];
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] === PROP_REMOVED) continue;
    const x = world.props.x[id]!, z = world.props.z[id]!;
    if (x >= left && x < left + building.width && z >= top && z < top + building.depth)
      removed.push(id);
  }
  building.clearedProps=removed.map(index=>({index,type:world.props.types[index]!}));
  if (removed.length) removePropsAt(world, removed);
  removed.push(...clearEntranceRoadProps(context, building));
  if (building.construction === 1) levelBuildingFoundation(world, building, context.buildings);
  else {
    let needsLeveling = false;
    for (let z = top; z <= top + building.depth; z++)
      for (let x = left; x <= left + building.width; x++)
        needsLeveling ||= Math.abs(world.heights[z * (cellsX + 1) + x]! - building.y) > .005;
    building.foundationProgress = needsLeveling ? 0 : 1;
    if (needsLeveling) building.status = "Waiting for shovel worker to level foundation";
  }
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * cellsX + x] = 1;
  const access = Math.floor(building.access.z) * cellsX + Math.floor(building.access.x);
  if (!isOpenArcherTower(building)) context.occupied[access] = 2;
  context.buildings.push(building);
  indexBuilding(context, building);
  bumpNavigationRevision(context);
  bumpBuildRevision(world, null);
  finishFoundationChange(world, change);
  context.options.onBuildingPlanned?.(building, removed);
  if (context.script) emitConstructionPlaced(context, building);
};
/**
 * A colony harbour turns its back to the open sea at its own plot (not the start point's, which a
 * far plot does not share); plots without sea in reach are skipped. A headquarters keeps rotation 0.
 */
const startPlotRotation = (world: WorldData, typeId: number) => {
  if (typeId !== 39) return () => 0;
  const sea = createSeaMask(world);
  const inland = rotationTowards(world.cellsX / 2 - world.start.x, world.cellsZ / 2 - world.start.z);
  return (x: number, z: number) => harbourShoreRotation(world, sea, x, z, inland);
};
/** A campaign map's landing harbour plot, when the start building is a harbour (C9a). */
const campaignLandingPlot = (scenario: MapScenario | undefined, typeId: number) =>
  scenario?.kind === "campaign" && typeId === HARBOUR_TYPE_ID ? scenario.harbourPlot : undefined;

/** The campaign run's home building: a finished landing harbour on the map's stored harbour plot. */
const placeLandingHarbour = (context: SettlementContext, plot: NonNullable<MapScenario["harbourPlot"]>) => {
  const building = makeBuilding(context, HARBOUR_TYPE_ID, plot.x, plot.z, plot.rotation);
  const reason = placementReason(context, building);
  if (reason) throw new Error(`Campaign landing harbour: ${reason}`);
  Object.assign(building, { colonyHome: true, construction: 1, foundationProgress: 1, foundedByExpedition: true,
    required: {}, status: "Colony harbour" });
  claimBuilding(context, building);
  return building;
};

/** The island's home building; none on an adventure island (`homeBuilding: null`). */
export const startHeadquarters = (context: SettlementContext) => {
  const { world } = context.options;
  if (context.options.restoredHome) {
    // Loading replaces this object's contents in place. Searching for a new start here would
    // grade a different temporary foundation into the already saved world before restoration.
    const building = structuredClone(context.options.restoredHome);
    context.buildings.push(building);
    indexBuilding(context, building);
    return building;
  }
  if (context.options.homeBuilding === null) return undefined;
  const typeId = context.options.homeBuilding ?? 0;
  const landing = campaignLandingPlot(world.scenario, typeId);
  if (landing) return placeLandingHarbour(context, landing);
  const authored = world.scenario?.headquarters;
  if (authored && typeId === 0) {
    const building = makeBuilding(context, 0, authored.x, authored.z, authored.rotation);
    const reason = placementReason(context, building);
    if (reason) throw new Error(`Authored headquarters: ${reason}`);
    building.construction = 1; building.foundationProgress = 1;
    building.required = {}; building.status = "Headquarters";
    claimBuilding(context, building);
    return building;
  }
  // Nearest valid calculated headquarters plot; preserve its integer-cell edges.
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  if (width !== depth) throw new Error("A start plot turns, so its footprint must be square");
  const candidates: Array<{ x: number; z: number; distance: number }> = [];
  const radius = Math.min(48, Math.max(world.cellsX, world.cellsZ));
  for (let z = Math.max(0, Math.floor(world.start.z) - radius); z < Math.min(world.cellsZ - depth, world.start.z + radius); z++)
    for (let x = Math.max(0, Math.floor(world.start.x) - radius); x < Math.min(world.cellsX - width, world.start.x + radius); x++)
      candidates.push({ x: x + width / 2, z: z + depth / 2, distance: DMath.hypot(x + width / 2 - world.start.x, z + depth / 2 - world.start.z) });
  candidates.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  const rotationAt = startPlotRotation(world, typeId);
  for (const point of candidates) {
    const rotation = rotationAt(point.x, point.z);
    if (rotation === null) continue;
    const building = makeBuilding(context, typeId, point.x, point.z, rotation);
    if (placementReason(context, building)) continue;
    building.construction = 1; building.required = {}; building.status = "Headquarters";
    if (typeId === 39) Object.assign(building, { colonyHome: true, foundedByExpedition: true, status: "Colony harbour" });
    claimBuilding(context, building);
    return building;
  }
  throw new Error("No valid headquarters plot near the player start");
};
