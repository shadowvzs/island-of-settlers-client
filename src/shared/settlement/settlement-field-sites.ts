import { DMath } from "../math/deterministic-math";
import { BUILD } from "../world/world-data";
import { getProductionRule } from "./production-rules";
import { roadDecorationFieldBounds } from "./road-decoration-fields";
import { roadStripIndex } from "./road-reserved-strip";
import { hasRoadRoute } from "./road-route-helpers";
import type { FieldKind, SettlementFieldFrame } from "./settlement-field-cycles";
import { createFieldRoadClearance } from "./settlement-field-roads";
import { buildingNation } from "./settlement-nation";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementContext } from "./settlement-types";

export const createFieldSiteValidator = (context: SettlementContext, sites: SettlementFieldFrame[]) => {
  const { world } = context.options;
  const clearOfRoads = createFieldRoadClearance(context);
  /** Cell, neighbour and spacing rules: cheap lookups, checked before any geometry. */
  const isFreeCell = (x: number, z: number, ignoreField: number | undefined, grain: boolean, spacing: number) => {
    const id = z * world.cellsX + x;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ || !world.walkCost[id] ||
      context.occupied[id] || world.blocking?.[id] ||
      world.buildClass[id]! < (grain ? BUILD.flag : BUILD.small) || world.buildClass[id]! > BUILD.large) return false;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (DMath.hypot(dx, dz) >= Math.min(spacing, 1.4)) continue;
      const nx = x + dx, nz = z + dz, nearby = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (context.reservations.has(`plant:${nearby}`) ||
        (nearby !== ignoreField && context.reservations.has(`field:${nearby}`))) return false;
    }
    // Paddies, hives, palms and vines keep every road's full stone width clear (owner, 2026-10-14).
    if (!roadStripIndex(context.options.roads).isCellClear(x, z)) return false;
    return !sites.some((site) => site.id !== ignoreField && site.state !== "stubble" &&
      DMath.hypot(site.x - x - 0.5, site.z - z - 0.5) < spacing);
  };
  const isGrainGroundClear = (x: number, z: number) => {
    if (!clearOfRoads(x + .5, z + .5)) return false;
    if (world.props) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (DMath.hypot(dx, dz) > 2) continue;
      if (!isNavigationClear(context, { x: x + .5 + dx * .35, z: z + .5 + dz * .35 })) return false;
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > 1) continue;
      const nx = x + dx, nz = z + dz, cell = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ ||
        !world.walkCost[cell] || context.occupied[cell] || world.blocking?.[cell]) return false;
      const p = { x: x + .5 + dx * .7, z: z + .5 + dz * .7 };
      if (hasRoadRoute(context.options.roads, p, p)) return false;
    }
    return true;
  };
  /** Stock contact geometry is costly (LOG-02: a farm scanning its area took ~100 ms each second): last. */
  const isClearOfStockApproaches = (x: number, z: number) => {
    const stockContact = context.options.stockContact;
    if (!stockContact) return true;
    for (const building of context.buildings) {
      if (DMath.hypot(building.x - x - .5, building.z - z - .5) > 8) continue;
      const rule = getProductionRule(building.typeId, buildingNation(context, building));
      const outputs = new Set([...(rule?.outputs ?? []), ...Object.keys(building.output ?? {})]);
      const inputs = new Set([...(rule?.inputs ?? []), ...Object.keys(building.required ?? {})]);
      for (const kind of ["input", "output"] as const) for (const ware of kind === "input" ? inputs : outputs) {
        const contact = stockContact(building, kind, ware, 0);
        if (contact && DMath.hypot(contact.approach.x - x - .5, contact.approach.z - z - .5) < 1.1) return false;
      }
    }
    return true;
  };
  // Wheat uses dry crop soil, including Flag-grade ground that cannot fit another house.
  /** `spacing`: least distance to another plot or reservation (adjoining rice paddies use 1). */
  const canUse = (x: number, z: number, ignoreField?: number, grain = false, spacing = grain ? 1.7 : 1.4, kind: FieldKind = "grain") => {
    if (!isFreeCell(x, z, ignoreField, grain, spacing)) return false;
    if (context.roadDecorations?.frames().length && !context.roadDecorations.isFree(roadDecorationFieldBounds(context, kind, x + .5, z + .5))) return false;
    return !grain || (isGrainGroundClear(x, z) && isClearOfStockApproaches(x, z));
  };
  return canUse;
};
