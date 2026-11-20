import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { createRoadNetwork } from "./road-network";
import { findUsableOrePlots } from "./settlement-ore-placement";
import { placementReason } from "./settlement-placement";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Two non-overlapping legal mine plots, each with a road approach to the colony harbour. */
export const colonyMineSites = (world: WorldData, home: SettlementBuilding, wanted = 2) => {
  const occupied = new Uint8Array(world.cellsX * world.cellsZ);
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => occupied[Math.floor(z) * world.cellsX + Math.floor(x)] === 1 });
  const context = { options: { world, roads }, occupied, buildings: [home], nextBuilding: home.uid + 1 } as SettlementContext;
  const reserve = (site: SettlementBuilding) => {
    for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
      for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++) occupied[z * world.cellsX + x] = 1;
  };
  reserve(home);
  const ore = world.mineZones.find(zone => zone.surveyed)?.ore;
  if (ore === undefined) return [];
  const cells = Array.from(world.oreAmount, (amount, cell) => amount ? cell : -1).filter(cell => cell >= 0);
  const plots = findUsableOrePlots(context, cells, ore);
  const distance = (site: SettlementBuilding) => DMath.hypot(site.x - home.x, site.z - home.z);
  plots.sort((a, b) => distance(a) - distance(b) || a.z - b.z || a.x - b.x || a.rotation - b.rotation);
  const sites: SettlementBuilding[] = [];
  for (const site of plots) {
    const { depth, width } = site;
    if (placementReason(context, site)) continue;
    reserve(site);
    const route = roads.planRoad(home.access, site.access);
    if (!route || sites.some(other => !roads.planRoad(home.access, other.access))) {
      for (let z = site.z - depth / 2; z < site.z + depth / 2; z++)
        for (let x = site.x - width / 2; x < site.x + width / 2; x++) occupied[z * world.cellsX + x] = 0;
      continue;
    }
    sites.push(site); context.buildings.push(site);
    if (sites.length >= wanted) return sites;
  }
  return sites;
};
