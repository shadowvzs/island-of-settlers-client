import { TERRITORY_RADII } from "../balance/territory";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type WorldData } from "../world/world-data";
import { HEADQUARTERS_TYPE_ID } from "./building-type-ids";
import { findFactionHome, isOwnBuilding } from "./settlement-home";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { STONEMASON_RADIUS } from "./settlement-stone-area";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { territoryRadius } from "./workshop-upgrades";

interface TerritorySource extends SettlementPoint {
  uid: number;
  radius: number;
}
export interface TerritoryBorderPoint extends SettlementPoint {
  y: number;
  yaw: number;
}
export interface SettlementTerritory {
  revision: number;
  sources: readonly TerritorySource[];
  owned: Uint8Array;
  borders: readonly TerritoryBorderPoint[];
}
interface CachedTerritory {
  signature: string;
  snapshot: SettlementTerritory;
}
/** The player's territory (faction 0, read every tick); other owners live in `ownerCaches`, built on demand. */
const caches = new WeakMap<SettlementContext, CachedTerritory>();
const ownerCaches = new WeakMap<SettlementContext, Map<number, CachedTerritory>>();

const garrisonedSites = (context: SettlementContext) => {
  const occupied = new Set<number>();
  for (const actor of context.actors) {
    if (actor.job === "Soldier" && actor.phase === "garrison") occupied.add(actor.building);
  }
  return occupied;
};

const claimsLand = (building: SettlementBuilding, owner: number, occupied: ReadonlySet<number>) =>
  building.construction === 1 && ownerOf(building) === owner &&
  ((building.typeId === 39 && building.foundedByExpedition) || (TERRITORY_RADII[building.typeId] !== undefined &&
    (building.typeId === HEADQUARTERS_TYPE_ID || building.territoryClaimed || occupied.has(building.uid))));

const toSource = (building: SettlementBuilding): TerritorySource => ({
  uid: building.uid, x: building.x, z: building.z,
  radius: building.typeId === 39 ? STONEMASON_RADIUS : territoryRadius(building)!
});

/**
 * Only a completed headquarters or an actually stationed soldier claims land. The player's stationed
 * sites keep the saved `territoryClaimed` mark; another owner's territory is a pure read (no mark is
 * written, so asking for it never changes the save): its stationed sites claim while occupied.
 */
const territorySources = (context: SettlementContext, owner: number): TerritorySource[] => {
  const occupied = garrisonedSites(context);
  if (owner === PLAYER_FACTION) {
    for (const building of context.buildings)
      if (occupied.has(building.uid) && isOwnBuilding(building) &&
        TERRITORY_RADII[building.typeId] !== undefined) building.territoryClaimed = true;
  }
  return context.buildings.filter(building => claimsLand(building, owner, occupied)).map(toSource);
};

const paintOwnership = (context: SettlementContext, sources: readonly TerritorySource[]) => {
  const { world } = context.options;
  const owned = new Uint8Array(world.cellsX * world.cellsZ);
  for (const source of sources) {
    const left = Math.max(0, Math.floor(source.x - source.radius));
    const right = Math.min(world.cellsX - 1, Math.ceil(source.x + source.radius));
    const top = Math.max(0, Math.floor(source.z - source.radius));
    const bottom = Math.min(world.cellsZ - 1, Math.ceil(source.z + source.radius));
    for (let z = top; z <= bottom; z++) {
      for (let x = left; x <= right; x++) {
        if ((x + .5 - source.x) * (x + .5 - source.x) +
          (z + .5 - source.z) * (z + .5 - source.z) <= source.radius * source.radius)
          owned[z * world.cellsX + x] = 1;
      }
    }
  }
  return owned;
};

/** Posts follow the exposed arcs of the union; overlaps never create interior borders. */
const borderPoints = (context: SettlementContext, sources: readonly TerritorySource[]): TerritoryBorderPoint[] => {
  const { world } = context.options;
  const points: TerritoryBorderPoint[] = [];
  const buckets = new Map<string, TerritoryBorderPoint[]>();
  for (const source of sources) {
    const count = Math.ceil(Math.PI * 2 * source.radius / 2);
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count;
      const x = source.x + DMath.cos(angle) * source.radius;
      const z = source.z + DMath.sin(angle) * source.radius;
      if (x < .3 || z < .3 || x >= world.cellsX - .3 || z >= world.cellsZ - .3) continue;
      if (sources.some(other => other.uid !== source.uid
        && DMath.hypot(x - other.x, z - other.z) < other.radius + .15)) continue;
      const cell = Math.floor(z) * world.cellsX + Math.floor(x);
      if (!world.walkCost[cell] || world.blocking[cell] === BLOCKING.water) continue;
      const bx = Math.floor(x / 2), bz = Math.floor(z / 2);
      let nearby = false;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (buckets.get(`${bx + dx}:${bz + dz}`)?.some(point => DMath.hypot(x - point.x, z - point.z) < 1.4))
            nearby = true;
        }
      }
      if (nearby) continue;
      const point = { x, z, y: sampleSmooth(world, world.heights, x, z), yaw: Math.PI / 2 - angle };
      points.push(point);
      const key = `${bx}:${bz}`;
      const group = buckets.get(key) ?? [];
      group.push(point);
      buckets.set(key, group);
    }
  }
  return points;
};

const cacheOf = (context: SettlementContext, owner: number) => {
  if (owner === PLAYER_FACTION) return caches.get(context);
  return ownerCaches.get(context)?.get(owner);
};

const storeCache = (context: SettlementContext, owner: number, entry: CachedTerritory) => {
  if (owner === PLAYER_FACTION) {
    caches.set(context, entry);
    return;
  }
  let perOwner = ownerCaches.get(context);
  if (!perOwner) ownerCaches.set(context, perOwner = new Map());
  perOwner.set(owner, entry);
};

export const settlementTerritory = (context: SettlementContext, owner = PLAYER_FACTION): SettlementTerritory => {
  const sources = territorySources(context, owner);
  const { world } = context.options;
  const signature = `${world.buildRevision ?? 0}|${sources.map(source =>
    `${source.uid}:${source.x}:${source.z}:${source.radius}`).join("|")}`;
  const cached = cacheOf(context, owner);
  if (cached?.signature === signature) return cached.snapshot;
  const snapshot = {
    revision: (cached?.snapshot.revision ?? 0) + 1,
    sources,
    owned: paintOwnership(context, sources),
    borders: borderPoints(context, sources)
  };
  storeCache(context, owner, { signature, snapshot });
  return snapshot;
};

const ownedPoint = (world: WorldData, owned: Uint8Array, point: SettlementPoint) => {
  if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return false;
  return owned[Math.floor(point.z) * world.cellsX + Math.floor(point.x)] === 1;
};

export const ownsTerritoryPoint = (context: SettlementContext, point: SettlementPoint, owner = PLAYER_FACTION) =>
  ownedPoint(context.options.world, settlementTerritory(context, owner).owned, point);

export const territoryPlacementReason = (
  context: SettlementContext, building: SettlementBuilding, owner = PLAYER_FACTION
) => {
  // HQ bootstrap precedes its own territory. Existing buildings in old saves are never removed.
  if (!findFactionHome(context, owner)) return null;
  const { world } = context.options;
  const { owned } = settlementTerritory(context, owner);
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  for (let z = top; z < top + building.depth; z++) {
    for (let x = left; x < left + building.width; x++) {
      if (owned[z * world.cellsX + x] !== 1) return "Build inside your territory; station soldiers to expand it";
    }
  }
  if (!ownsTerritoryPoint(context, building.access, owner)) return "Building entrance must be inside your territory";
  return null;
};

export const resetTerritoryCache = (context: SettlementContext) => {
  ownerCaches.delete(context);
  caches.delete(context);
};

export const ownsTerritoryRoute = (context: SettlementContext, points: readonly SettlementPoint[],
  owned?: Uint8Array, owner = PLAYER_FACTION) => {
  if (!points.length) return false;
  const ownership = owned ?? settlementTerritory(context, owner).owned;
  const { world } = context.options;
  for (let index = 0; index < points.length; index++) {
    const end = points[index]!, start = points[Math.max(0, index - 1)]!;
    const count = Math.max(1, Math.ceil(DMath.hypot(end.x - start.x, end.z - start.z) * 4));
    for (let step = 0; step <= count; step++) {
      if (!ownedPoint(world, ownership, {
        x: start.x + (end.x - start.x) * step / count,
        z: start.z + (end.z - start.z) * step / count
      })) return false;
    }
  }
  return true;
};
