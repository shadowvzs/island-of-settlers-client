import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createGameSave, type GameSaveV1, type LoadedGameSave,
readGameSave} from "../../src/shared/settlement/game-save";
import { STORAGE_IDS } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { findHomeBuilding } from "../../src/shared/settlement/settlement-home";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import {
  DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions
} from "../../src/shared/world/generation/generate-world";
import { BLOCKING, FOG, type WorldData } from "../../src/shared/world/world-data";

export const FIXTURE_MAP_SIZE = 256;
export const FIXTURE_SEED = 20261027;
export const FIXTURE_SAVED_AT = 1_793_000_000_000;
export const FIXTURE_SOURCE = "home-map-island-fixtures-2026-10-27";
export const FIXTURE_COUNTS = [2, 5, 9] as const;
export const EXPECTED_OWNER_SHA256 =
  "90c8e1405a897a92ad209c8de167177f2c84a35d9ae390b3805e4ae367d1c231";

export interface PointSummary { x: number; z: number }
export interface BoundsSummary { minX: number; minZ: number; maxX: number; maxZ: number }
export interface SiteSummary {
  index: number;
  x: number;
  z: number;
  radius: number;
  phase: number;
  buildingCount: number;
  headquarters: PointSummary;
  harbour: PointSummary & { rotation: number };
  landmassIndex: number | null;
}
export interface LandmassSummary {
  index: number;
  area: number;
  bounds: BoundsSummary;
  centroid: PointSummary;
  coastCells: number;
  coastHash: string;
  cellHash: string;
  playableSiteIndex: number | null;
  buildings: number;
  actors: number;
}
export interface WorldSummary {
  seed: number;
  cellsX: number;
  cellsZ: number;
  landmassCount: number;
  landmasses: LandmassSummary[];
  playableSites: SiteSummary[];
  geometryHash: string;
}
export interface SettlementFixtureSummary {
  actors: number;
  actorsByJob: Array<{ job: string; count: number }>;
  buildings: number;
  buildingTypeCounts: Array<{ typeId: number; count: number }>;
  colonyHomes: number[];
  expeditionHarbours: number[];
  factionCounts: Array<{ faction: number; count: number }>;
  fleetOrders: number;
  foundedByExpedition: number;
  harbourCount: number;
  harbourStock: Array<{ inventory: Record<string, number>; uid: number }>;
  home: null | {
    colonyHome: boolean;
    foundedByExpedition: boolean;
    typeId: number;
    uid: number;
    x: number;
    z: number;
  };
  homes: number[];
  playerBuildings: number;
  preparationCount: number;
  roadSegments: number;
  roadStorage: {
    anchorUid: number | null;
    anchorLandmassIndex: number | null;
    connectedStorages: number;
    storages: number;
    unconnectedStorageUids: number[];
  };
  settlers: number;
  shipPhases: Array<{ phase: string; count: number }>;
  ships: number;
  spyglasses: number;
  territoryClaimed: number;
}
export interface FogSummary {
  discovered: number;
  hidden: number;
  permanentVisible: number;
  visible: number;
}
export interface SaveSummary {
  format: string;
  savedAt: number;
  version: number;
  world: WorldSummary;
  fog: FogSummary;
  settlement: SettlementFixtureSummary;
}
export interface FixtureRecord {
  counts: {
    actors: number;
    buildings: number;
    settlers: number;
    ships: number;
  };
  options: WorldOptions;
  origin: "generated";
  path: string;
  requestedLandmasses: number;
  saveMeta: { name: string; savedAt: number; source: string };
  sha256: string;
  summary: SaveSummary;
}
export interface OwnerBaselineRecord {
  originalExport: string;
  origin: "owner-save";
  path: string;
  sha256: string;
  sourcePath: string;
  summary: SaveSummary;
}
export interface FixtureManifest {
  fixtures: FixtureRecord[];
  format: "home-map-island-fixtures";
  generatedBy: string;
  mapSize: number;
  ownerBaseline: OwnerBaselineRecord | null;
  seed: number;
  version: 1;
}

export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const hashUint32 = (values: readonly number[]) => {
  const bytes = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value >>> 0, index * 4));
  return sha256(bytes);
};

const hashJson = (value: unknown) => sha256(JSON.stringify(value));

const pointInWorld = (world: Pick<WorldData, "cellsX" | "cellsZ">, point: PointSummary) =>
  point.x >= 0 && point.z >= 0 && point.x < world.cellsX && point.z < world.cellsZ;

const isDry = (world: WorldData, cell: number) => world.blocking[cell] !== BLOCKING.water;

interface IndexedLandmass {
  cells: number[];
  id: number;
}
interface LandmassIndex {
  labels: Int32Array;
  landmasses: IndexedLandmass[];
}
const indexLandmasses = (world: WorldData): LandmassIndex => {
  const { cellsX, cellsZ } = world;
  const labels = new Int32Array(world.blocking.length).fill(-1);
  const landmasses: IndexedLandmass[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start]! >= 0 || !isDry(world, start)) continue;
    const id = landmasses.length, cells: number[] = [], pending = [start];
    labels[start] = id;
    while (pending.length) {
      const cell = pending.pop()!;
      cells.push(cell);
      const x = cell % cellsX, z = Math.floor(cell / cellsX);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= cellsX || nz >= cellsZ) continue;
        const next = nz * cellsX + nx;
        if (labels[next]! >= 0 || !isDry(world, next)) continue;
        labels[next] = id;
        pending.push(next);
      }
    }
    landmasses.push({ cells, id });
  }
  return { labels, landmasses };
};

const nearestComponent = (world: WorldData, index: LandmassIndex, point: PointSummary) => {
  if (!pointInWorld(world, point)) return null;
  const direct = index.labels[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]!;
  if (direct >= 0) return direct;
  for (let radius = 1; radius <= 6; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
      const x = Math.floor(point.x) + dx, z = Math.floor(point.z) + dz;
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) continue;
      const label = index.labels[z * world.cellsX + x]!;
      if (label >= 0) return label;
    }
  }
  return null;
};

const rankById = (landmasses: readonly IndexedLandmass[]) => {
  const sorted = [...landmasses].sort((left, right) => right.cells.length - left.cells.length ||
    left.cells[0]! - right.cells[0]!);
  return new Map(sorted.map((landmass, rank) => [landmass.id, rank + 1] as const));
};

const coastValues = (world: WorldData, cells: readonly number[]) => {
  const { cellsX, cellsZ } = world;
  const values: number[] = [];
  for (const cell of [...cells].sort((left, right) => left - right)) {
    const x = cell % cellsX, z = Math.floor(cell / cellsX);
    let waterNeighbours = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= cellsX || nz >= cellsZ ||
        !isDry(world, nz * cellsX + nx)) waterNeighbours++;
    }
    if (!waterNeighbours) continue;
    values.push(cell, waterNeighbours);
  }
  return values;
};

const worldSummary = (world: WorldData): WorldSummary => {
  const index = indexLandmasses(world), rank = rankById(index.landmasses);
  const sites = world.playableIslands?.sites ?? [];
  const sitesByLandmass = new Map<number, number>();
  const siteSummaries: SiteSummary[] = sites.map((site, siteIndex) => {
    const landmassId = nearestComponent(world, index, site);
    if (landmassId !== null) {
      const landmassRank = rank.get(landmassId)!;
      if (!sitesByLandmass.has(landmassRank)) sitesByLandmass.set(landmassRank, siteIndex);
    }
    return {
      buildingCount: site.buildingCount,
      harbour: { ...site.harbour },
      headquarters: { ...site.headquarters },
      index: siteIndex,
      landmassIndex: landmassId === null ? null : rank.get(landmassId)!,
      phase: site.phase,
      radius: site.radius,
      x: site.x,
      z: site.z
    };
  });
  const landmasses = [...index.landmasses].sort((left, right) => rank.get(left.id)! - rank.get(right.id)!)
    .map((landmass): LandmassSummary => {
      let minX = world.cellsX, minZ = world.cellsZ, maxX = -1, maxZ = -1, sumX = 0, sumZ = 0;
      for (const cell of landmass.cells) {
        const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
        minX = Math.min(minX, x); minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
        sumX += x + .5; sumZ += z + .5;
      }
      const rankIndex = rank.get(landmass.id)!, coast = coastValues(world, landmass.cells);
      return {
        actors: 0,
        area: landmass.cells.length,
        bounds: { maxX, maxZ, minX, minZ },
        buildings: 0,
        cellHash: hashUint32([...landmass.cells].sort((left, right) => left - right)),
        centroid: {
          x: +(sumX / landmass.cells.length).toFixed(3),
          z: +(sumZ / landmass.cells.length).toFixed(3)
        },
        coastCells: coast.length / 2,
        coastHash: hashUint32(coast),
        index: rankIndex,
        playableSiteIndex: sitesByLandmass.get(rankIndex) ?? null
      };
    });
  const geometry = {
    landmasses: landmasses.map(({ area, bounds, cellHash, coastHash }) => ({
      area, bounds, cellHash, coastHash
    })),
    playableSites: siteSummaries,
    seed: world.seed,
    size: [world.cellsX, world.cellsZ]
  };
  return {
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    geometryHash: hashJson(geometry),
    landmassCount: landmasses.length,
    landmasses,
    playableSites: siteSummaries,
    seed: world.seed
  };
};

const homeType = (building: SettlementBuilding) => building.typeId === 0 ||
  building.colonyHome === true;

const connectedRoadStorages = (world: WorldData, settlement: SettlementSaveV1,
  labels: Int32Array, rank: Map<number, number>) => {
  const storages = settlement.buildings.filter(building => building.construction === 1 &&
    !building.militaryFaction && STORAGE_IDS.has(building.typeId));
  const anchor = storages.find(building => building.typeId === 0 || building.colonyHome) ?? storages[0];
  if (!anchor) return { anchorUid: null, anchorLandmassIndex: null, connectedStorages: 0,
    storages: 0, unconnectedStorageUids: [] };
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(settlement.roads)) throw new Error("Invalid saved road network");
  const connected = storages.filter(storage => storage.uid === anchor.uid ||
    Boolean(roads.routeMetrics(anchor.access, storage.access).route));
  const anchorCell = Math.floor(anchor.z) * world.cellsX + Math.floor(anchor.x);
  const anchorLabel = labels[anchorCell]!;
  return {
    anchorLandmassIndex: anchorLabel < 0 ? null : rank.get(anchorLabel)!,
    anchorUid: anchor.uid,
    connectedStorages: connected.length,
    storages: storages.length,
    unconnectedStorageUids: storages.filter(storage => !connected.includes(storage)).map(storage => storage.uid)
  };
};

export const summarizeSave = (save: GameSaveV1, loaded: LoadedGameSave): SaveSummary => {
  const { world } = loaded.map, settlement = loaded.settlement, index = indexLandmasses(world);
  const rank = rankById(index.landmasses);
  const pointRank = (point: PointSummary) => {
    if (!pointInWorld(world, point)) return null;
    const label = index.labels[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]!;
    return label < 0 ? null : rank.get(label)!;
  };
  const buildingsByLandmass = new Map<number, number>();
  for (const building of settlement.buildings) {
    const landmass = pointRank(building);
    if (landmass !== null) buildingsByLandmass.set(landmass, (buildingsByLandmass.get(landmass) ?? 0) + 1);
  }
  const actorsByLandmass = new Map<number, number>();
  for (const actor of settlement.actors) {
    const landmass = pointRank(actor);
    if (landmass !== null) actorsByLandmass.set(landmass, (actorsByLandmass.get(landmass) ?? 0) + 1);
  }
  const worldData = worldSummary(world);
  for (const landmass of worldData.landmasses) {
    landmass.buildings = buildingsByLandmass.get(landmass.index) ?? 0;
    landmass.actors = actorsByLandmass.get(landmass.index) ?? 0;
  }
  const factionCounts = [...new Set(settlement.buildings.map(building => building.militaryFaction ?? 0))]
    .sort((left, right) => left - right)
    .map(faction => ({ count: settlement.buildings.filter(building =>
      (building.militaryFaction ?? 0) === faction).length, faction }));
  const buildingTypeCounts = [...new Set(settlement.buildings.map(building => building.typeId))]
    .sort((left, right) => left - right)
    .map(typeId => ({ count: settlement.buildings.filter(building => building.typeId === typeId).length, typeId }));
  const actorsByJob = [...new Set(settlement.actors.map(actor => actor.job))].sort()
    .map(job => ({ count: settlement.actors.filter(actor => actor.job === job).length, job }));
  const ships = settlement.naval.fleet.ships;
  const shipPhases = [...new Set(ships.map(ship => ship.phase))].sort()
    .map(phase => ({ count: ships.filter(ship => ship.phase === phase).length, phase }));
  const home = findHomeBuilding(settlement);
  const homes = settlement.buildings.filter(homeType).map(building => building.uid);
  const fog = { discovered: 0, hidden: 0, permanentVisible: 0, visible: 0 };
  for (const value of world.fog) {
    if (value === FOG.hidden) fog.hidden++;
    else if (value === FOG.discovered) fog.discovered++;
    else fog.visible++;
  }
  if (world.permanentFog) for (const value of world.permanentFog)
    if (value === FOG.visible) fog.permanentVisible++;
  return {
    fog,
    format: save.format,
    savedAt: save.savedAt,
    settlement: {
      actors: settlement.actors.length,
      actorsByJob,
      buildings: settlement.buildings.length,
      buildingTypeCounts,
      colonyHomes: settlement.buildings.filter(building => building.colonyHome).map(building => building.uid),
      expeditionHarbours: settlement.buildings.filter(building => building.foundedByExpedition)
        .map(building => building.uid),
      factionCounts,
      fleetOrders: settlement.naval.fleet.orders.length,
      foundedByExpedition: settlement.buildings.filter(building => building.foundedByExpedition).length,
      harbourCount: settlement.buildings.filter(building => building.typeId === 39).length,
      harbourStock: settlement.buildings.filter(building => building.typeId === 39)
        .map(building => ({ inventory: { ...building.inventory }, uid: building.uid })),
      home: home ? {
        colonyHome: home.colonyHome === true,
        foundedByExpedition: home.foundedByExpedition === true,
        typeId: home.typeId,
        uid: home.uid,
        x: home.x,
        z: home.z
      } : null,
      homes,
      playerBuildings: settlement.buildings.filter(building => (building.militaryFaction ?? 0) === 0).length,
      preparationCount: settlement.naval.preparation.preparations.length,
      roadSegments: settlement.roads.length,
      roadStorage: connectedRoadStorages(world, settlement, index.labels, rank),
      settlers: settlement.settlers,
      shipPhases,
      ships: ships.length,
      spyglasses: settlement.buildings.reduce((total, building) =>
        total + (building.inventory.spyglass ?? 0), 0),
      territoryClaimed: settlement.buildings.filter(building => building.territoryClaimed).length
    },
    version: save.version,
    world: worldData
  };
};

export const buildFixtureOptions = (requestedLandmasses: number): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: FIXTURE_MAP_SIZE,
  cellsZ: FIXTURE_MAP_SIZE,
  islandCount: requestedLandmasses,
  landform: "archipelago",
  rivers: 0,
  seed: FIXTURE_SEED,
  similarIslandSizes: true
});

export const buildFixture = async (options: WorldOptions, saveMeta: FixtureRecord["saveMeta"]) => {
  const world = generateWorld(options);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ roads, world });
  const settlement = simulation.saveState();
  const save = await createGameSave(world, settlement, { animals: [], ...saveMeta });
  const bytes = Buffer.from(JSON.stringify(save));
  const loaded = await readGameSave(JSON.parse(bytes.toString("utf8")));
  return { bytes, save, summary: summarizeSave(save, loaded) };
};

export const buildFixtureRecord = async (requestedLandmasses: number) => {
  const options = buildFixtureOptions(requestedLandmasses);
  const name = `Home map ${requestedLandmasses} landmasses, 256x256`;
  const saveMeta = { name, savedAt: FIXTURE_SAVED_AT + requestedLandmasses, source: FIXTURE_SOURCE };
  const built = await buildFixture(options, saveMeta);
  const { bytes, summary } = built;
  if (summary.world.landmassCount !== requestedLandmasses)
    throw new Error(`Requested ${requestedLandmasses} landmasses but generated ${summary.world.landmassCount}`);
  const record: FixtureRecord = {
    counts: {
      actors: summary.settlement.actors,
      buildings: summary.settlement.buildings,
      settlers: summary.settlement.settlers,
      ships: summary.settlement.ships
    },
    options,
    origin: "generated",
    path: `generated/home-map-${requestedLandmasses}-landmasses-256.save.json`,
    requestedLandmasses,
    saveMeta,
    sha256: sha256(bytes),
    summary
  };
  return { bytes, record };
};

export const loadSaveFile = async (path: string) => {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
  const loaded = await readGameSave(value);
  return { bytes, loaded, save: value, summary: summarizeSave(value, loaded) };
};
