import { createHarbourBerths } from "./settlement-harbour-berths";
import { createSeaMask, findCoastalWorkSite, SHIPYARD_RADIUS } from "./settlement-sea-navigation";
import { createShipRoutePlanner } from "./settlement-ship-routes";
import { findShipWorkpoint } from "./settlement-ship-workpoint";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

const navigation = new WeakMap<SettlementContext, {
  sea: Uint8Array;
  planner: ReturnType<typeof createShipRoutePlanner>;
  revision?: string;
  reasons: Map<string, string | null>;
}>();
const navigationFor = (context: SettlementContext) => {
  let cached = navigation.get(context);
  if (!cached) {
    const sea = createSeaMask(context.options.world);
    cached = { sea, planner: createShipRoutePlanner(context.options.world, sea), reasons: new Map() };
    navigation.set(context, cached);
  }
  return cached;
};

/** Preview and construction use the same reachable ramp, hull space and launch proof. */
export const findShipyardWorkSite = (
  context: SettlementContext, building: SettlementBuilding, reserved: ReadonlySet<string> = new Set()
) => {
  const { planner, sea } = navigationFor(context);
  const held = new Set(reserved);
  for (let attempt = 0; attempt < 12; attempt++) {
    const coast = findCoastalWorkSite(context, building, sea, held);
    if (!coast) return null;
    const work = findShipWorkpoint(context, building, coast);
    if (work && planner.berthAccess({ ...coast.water, yaw: coast.yaw }, []))
      return { ...coast, land: work.shore, work };
    held.add(`${coast.water.x},${coast.water.z}`);
  }
  return null;
};

export const shipyardPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.typeId !== 36) return null;
  const { roads, world } = context.options;
  const cached = navigationFor(context);
  const revision = [world.buildRevision ?? 0, world.terrainRevision ?? 0, roads.revision ?? 0,
    context.navigationRevision ?? 0, context.buildings.length, world.props.count].join(":");
  if (cached.revision !== revision) {
    cached.revision = revision;
    cached.reasons.clear();
  }
  const key = `${building.x}:${building.z}:${building.rotation}`;
  if (cached.reasons.has(key)) return cached.reasons.get(key)!;
  // The proposed footprint must not become the only route to the shore after construction.
  const occupied = context.occupied.slice();
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      occupied[z * world.cellsX + x] = 1;
  const preview = { ...context, occupied };
  navigation.set(preview, cached);
  // Existing harbour berths are working water, not shipyard landing stages. Reserving them here
  // prevents two piers being laid on the same water point.
  const reserved = new Set<string>();
  const berths = createHarbourBerths(preview, cached.sea, cached.planner);
  for (const harbour of context.buildings)
    if (harbour.typeId === 39 && harbour.construction === 1)
      for (const berth of berths.forHarbour(harbour.uid, true))
        reserved.add(`${berth.x},${berth.z}`);
  const reason = (findShipyardWorkSite(preview, building, reserved) ??
    findShipyardWorkSite(preview, building)) ? null
    : `Shipyard needs a reachable hull work site and a navigable launch within ${SHIPYARD_RADIUS} tiles`;
  if (cached.reasons.size >= 256) cached.reasons.clear();
  cached.reasons.set(key, reason);
  return reason;
};
