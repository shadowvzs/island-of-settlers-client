import { createScenarioRoadNetwork } from "../../settlement/scenario-road-placement";
import { searchGroundPath } from "../../settlement/settlement-navigation";
import { makeBuilding, placementReason } from "../../settlement/settlement-placement";
import type { SettlementBuilding, SettlementContext } from "../../settlement/settlement-types";
import { createBuildClass } from "../build-class";
import { BLOCKING, BUILD, PROP_REMOVED, type WorldData } from "../world-data";
import { ISLAND_SPACE, islandHeadquarters, type IslandSite,reservedIslandGround } from "./archipelago-rules";
import { createCellTerrain } from "./gameplay";
import { createWalkCost } from "./walkability";

const contextFor = (world: WorldData): SettlementContext => ({
  options: { world, roads: { route: () => null, addRoad: () => {}, upgradeRoad: () => {} } },
  buildings: [], actors: [], occupied: new Uint8Array(world.cellsX * world.cellsZ),
  reservations: new Set(), nextBuilding: 0, nextActor: 0, settlers: 0,
  resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: []
});

const markFoundation = (context: SettlementContext, building: SettlementBuilding, occupied: number) => {
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * context.options.world.cellsX + x] = occupied;
};

/** Keep all four planned plots unavailable to the connecting road, using the layout's own dimensions. */
const reserveFuturePlots = (context: SettlementContext, site: IslandSite) => {
  const { buildingSide, columns, roadWidth, rows } = ISLAND_SPACE;
  const pitch = buildingSide + roadWidth;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = site.x - site.spaceWidth / 2 + roadWidth + column * pitch;
    const top = site.z - site.spaceDepth / 2 + roadWidth + row * pitch;
    for (let z = top; z < top + buildingSide; z++) for (let x = left; x < left + buildingSide; x++)
      context.occupied[z * context.options.world.cellsX + x] = 1;
  }
};

/**
 * Scratch settlement context with every island's HQ foundation and four future plots reserved: the
 * generation proofs (harbour spots) may not claim the ground the island layout promises.
 */
export const createReservedIslandContext = (world: WorldData, sites: readonly IslandSite[]) => {
  const context = contextFor(world);
  for (const site of sites) {
    reserveFuturePlots(context, site);
    const hqSite = islandHeadquarters(site), hq = makeBuilding(context, 0, hqSite.x, hqSite.z);
    markFoundation(context, hq, 1);
    context.buildings.push(hq);
  }
  return context;
};

/** Reserve the candidate itself too: a future road cannot cut through its harbour foundation. */
const hasHarbourRoad = (context: SettlementContext, hq: SettlementBuilding, harbour: SettlementBuilding) => {
  context.buildings.push(harbour);
  markFoundation(context, harbour, 1);
  try {
    return createScenarioRoadNetwork(context).planRoad(hq.access, harbour.access) !== null;
  } finally {
    markFoundation(context, harbour, 0);
    context.buildings.pop();
  }
};

/** Clear only reserved land, then prove real foundations, a connected route and a usable ocean berth. */
export const preparePlayableIslands = (world: WorldData, sites: readonly IslandSite[]) => {
  for (let index = 0; index < world.props.count; index++) {
    if (sites.some(site => reservedIslandGround(site, world.props.x[index]!, world.props.z[index]!, 4)))
      world.props.types[index] = PROP_REMOVED;
  }
  const terrain = createCellTerrain(world, world);
  world.blocking = terrain.blocking;
  world.slopeClass = terrain.slopeClass;
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    if (!sites.some(site => reservedIslandGround(site, x + .5, z + .5, 1))) continue;
    const cell = z * world.cellsX + x;
    if (world.blocking[cell] || world.slopeClass[cell]! > 1) continue;
    world.buildCap[cell] = BUILD.large;
    world.mineZone[cell] = 0;
    world.oreAmount[cell] = 0;
  }
  const deposits = world.mineZones.map(() => ({ count: 0, x: 0, z: 0 }));
  world.mineZone.forEach((id, cell) => {
    if (!id) return;
    const deposit = deposits[id - 1]!;
    deposit.count++; deposit.x += cell % world.cellsX + .5; deposit.z += Math.floor(cell / world.cellsX) + .5;
  });
  const zoneIds = new Uint16Array(deposits.length + 1);
  let nextZoneId = 1;
  world.mineZones = world.mineZones.flatMap((zone, index) => {
    const deposit = deposits[index]!;
    if (!deposit.count) return [];
    const id = nextZoneId++;
    zoneIds[zone.id] = id;
    return [{ ...zone, id, cellCount: deposit.count, centreX: deposit.x / deposit.count, centreZ: deposit.z / deposit.count }];
  });
  world.mineZone.forEach((id, cell) => { world.mineZone[cell] = zoneIds[id]!; });
  world.buildClass = createBuildClass(world);
  world.walkCost = createWalkCost(world, world.slopeClass, world.blocking, world.splat, world.props);
  // Rivers or coast noise must not leave a separate, unusable land fragment.
  const seen = new Uint8Array(world.blocking.length);
  for (let first = 0; first < seen.length; first++) {
    if (seen[first] || world.blocking[first] === BLOCKING.water) continue;
    const queue = [first]; seen[first] = 1;
    let hasSite = false;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      hasSite ||= sites.some(site => site.x === x && site.z === z);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
        if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || seen[next] || world.blocking[next] === BLOCKING.water) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    if (!hasSite) throw new Error("A disconnected island fragment has no reserved building area.");
  }
  const context = contextFor(world);
  const harbours: { x: number; z: number; rotation: number }[] = [];
  for (const site of sites) {
    // Non-overlapping 5x5 foundations and the complete three-tile road grid must all be flat and dry.
    for (let z = site.z - site.spaceDepth / 2; z < site.z + site.spaceDepth / 2; z++)
      for (let x = site.x - site.spaceWidth / 2; x < site.x + site.spaceWidth / 2; x++) {
        const cell = z * world.cellsX + x;
        if (world.blocking[cell] || world.slopeClass[cell] !== 0 || world.buildCap[cell] !== BUILD.large)
          throw new Error("An island has insufficient connected building and road space.");
      }
    // Reserve all future plots while testing roads; a route through a future house does not count.
    reserveFuturePlots(context, site);
    const hqSite = islandHeadquarters(site), hq = makeBuilding(context, 0, hqSite.x, hqSite.z);
    const hqReason = placementReason(context, hq);
    if (hqReason) throw new Error(`An island needs a separate usable HQ site: ${hqReason}`);
    markFoundation(context, hq, 1);
    context.buildings.push(hq);
    let harbour = false;
    const harbourFailures = new Map<string, number>();
    const refused = (reason: string) => harbourFailures.set(reason, (harbourFailures.get(reason) ?? 0) + 1);
    for (let offset = 5; offset <= 10 && !harbour; offset++) {
      for (let rotation = 0; rotation < 4 && !harbour; rotation++) {
        const draft = makeBuilding(context, 39, site.x, site.z + site.radius - offset, rotation);
        const reason = placementReason(context, draft);
        if (reason) { refused(reason); continue; }
        const route = searchGroundPath(context, hq.access, draft.access);
        if (!route.path) { refused(`HQ walking route: ${route.status}`); continue; }
        if (!hasHarbourRoad(context, hq, draft)) { refused("HQ road corridor or verge"); continue; }
        harbours.push({ x: draft.x, z: draft.z, rotation });
        harbour = true;
      }
    }
    if (!harbour) throw new Error("An island has no connected harbour with a usable ship approach. " +
      [...harbourFailures].map(([reason, count]) => `${count} candidates: ${reason}`).join("; "));
  }
  world.playableIslands = { minimumBuildingArea: { width: sites[0]!.spaceWidth, depth: sites[0]!.spaceDepth },
    channelWidth: ISLAND_SPACE.channelWidth, sites: sites.map((site, index) => ({ ...site, headquarters: islandHeadquarters(site), harbour: harbours[index]! })) };
  world.start = islandHeadquarters(sites[0]!);
};
