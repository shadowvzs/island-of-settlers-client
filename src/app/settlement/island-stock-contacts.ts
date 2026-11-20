import { fisheryYardSkiffAnchor, fisheryYardSkiffPickup } from "../../render-common/ships/fishing-skiff-yard";
import { getAuthoredBuildingPlot } from "../../render-common/buildings/building-plot-profile";
import { getRomanPartBounds } from "../../render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { CATAPULT_STONE_DIAMETER } from "../../render-common/buildings/catapult-mechanism";
import { CATAPULT_BLOCK_REST_LIFT } from "../../render-common/buildings/catapult-stone-presentation";
import { createWareRecipe } from "../../render-common/wares/ware-recipe";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { DMath } from "../../shared/math/deterministic-math";
import { type ConstructionMaterials, getConstructionCost } from "../../shared/settlement/construction-costs";
import { constructionStockLayout } from "../../shared/settlement/construction-stock-layout";
import { isNavigationClear } from "../../shared/settlement/settlement-navigation";
import type { SettlementBuilding, SettlementContext, SettlementOptions } from "../../shared/settlement/settlement-types";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { constructionStockApproach } from "./construction-stock-approach";

/** Bind simulation contacts to the same original stock recipes used by the native renderer. */
export const createIslandStockContacts = (
  world: WorldData,
  isOccupied?: (x: number, z: number) => boolean,
  nation: (building: SettlementBuilding) => WorkerNation | undefined = () => undefined
): NonNullable<SettlementOptions["stockContact"]> => {
  const dimensions = new Map<string, { minimum: number; pitch: number }>();
  // Stock stances must be physically reachable, not merely connected to the authored yard: a side
  // bay can otherwise sit over a cliff or water and leave every returner waiting forever.
  const navigation = { options: { world }, buildings: [], actors: [],
    occupied: new Uint8Array(0) } as unknown as SettlementContext;
  return (building, kind, ware, slot) => {
    if (building.construction < 1 && kind === "input") {
      // The site owns its nation-adjusted receipt; fall back only for an older/empty receipt.
      const cost: ConstructionMaterials = Object.keys(building.required ?? {}).length
        ? building.required as ConstructionMaterials : getConstructionCost(building.typeId);
      const capacity = cost[ware];
      if (!capacity) return null;
      let bounds = dimensions.get(ware);
      if (!bounds) {
        const parts = createWareRecipe(ware, true).parts.map((part) => getRomanPartBounds(part));
        const minimum = Math.min(...parts.map((part) => part.min[1]));
        bounds = {
          minimum,
          pitch: Math.max(...parts.map((part) => part.max[1])) - minimum + 0.018
        };
        dimensions.set(ware, bounds);
      }
      const yaw = (building.rotation * Math.PI) / 2;
      const cosine = Math.round(DMath.cos(yaw)),
        sine = Math.round(DMath.sin(yaw));
      // Building width/depth are rotated world dimensions; plan geometry uses local dimensions.
      const width = building.rotation % 2 ? building.depth : building.width;
      const depth = building.rotation % 2 ? building.width : building.depth;
      const layout = constructionStockLayout(cost, ware, slot, width, depth);
      if (!layout) return null;
      const { x, z } = layout;
      const stockX = building.x + x * cosine + z * sine;
      const stockZ = building.z - x * sine + z * cosine;
      const approachX = building.x + layout.approach.x * cosine + layout.approach.z * sine;
      const approachZ = building.z - layout.approach.x * sine + layout.approach.z * cosine;
      const approach = constructionStockApproach(
        world,
        building.access,
        { x: stockX, z: stockZ },
        { x: approachX, z: approachZ },
        isOccupied
      );
      return {
        ware,
        slot: layout.slot,
        yaw,
        scale: 1,
        stock: {
          x: stockX,
          z: stockZ,
          y:
            sampleSmooth(world, world.heights, stockX, stockZ) -
            bounds.minimum +
            0.03 +
            layout.layer * bounds.pitch
        },
        approach: { ...approach, y: sampleSmooth(world, world.heights, approach.x, approach.z) }
      };
    }
    if (building.typeId === 18 && building.construction === 1 && kind === "input" && ware === "boat") {
      const anchor = fisheryYardSkiffAnchor(nation(building) ?? "roman", building);
      const stance = fisheryYardSkiffPickup(nation(building) ?? "roman", building);
      return { ware, slot: 0, yaw: anchor.yaw, stock: { x: anchor.x, y: building.y, z: anchor.z },
        approach: { x: stance.x, y: sampleSmooth(world, world.heights, stance.x, stance.z), z: stance.z } };
    }
    if (building.typeId === 16 && kind === "input" && ware === "stone") {
      const scale = getAuthoredBuildingPlot(16)!.structureScale, yaw = building.rotation * Math.PI / 2;
      const pitch = CATAPULT_STONE_DIAMETER + .02;
      const x = .48 + (slot % 2) * pitch, z = .94 + Math.floor(slot / 2) * pitch;
      const point = (px: number, pz: number) => ({
        x: building.x + (px * DMath.cos(yaw) + pz * DMath.sin(yaw)) * scale,
        z: building.z + (pz * DMath.cos(yaw) - px * DMath.sin(yaw)) * scale
      });
      const stock = point(x, z), approach = point(x, z + .28);
      // Delivered stone rests as the carriers' cut block; round shot is shaped later, inside.
      const stockY = sampleSmooth(world, world.heights, stock.x, stock.z) + CATAPULT_BLOCK_REST_LIFT;
      return { ware, slot, yaw, stock: { ...stock, y: stockY },
        approach: { ...approach, y: sampleSmooth(world, world.heights, approach.x, approach.z) } };
    }
    const ownPlot = (point: { x: number; z: number }) =>
      point.x >= building.x - building.width / 2 && point.x <= building.x + building.width / 2 &&
      point.z >= building.z - building.depth / 2 && point.z <= building.z + building.depth / 2;
    const stockStanceWalkable = (point: { x: number; z: number }) => {
      if (!isNavigationClear(navigation, point)) return false;
      if (!isOccupied?.(point.x, point.z)) return true;
      // The building's own plot is owner-walkable through the courtyard lane; its reserved access
      // cell is the guaranteed outside fallback. Any other occupied cell belongs to a neighbour.
      return ownPlot(point) || (Math.floor(point.x) === Math.floor(building.access.x) &&
        Math.floor(point.z) === Math.floor(building.access.z));
    };
    const contact = getBuildingStockContact(
      building.typeId,
      kind,
      ware,
      slot,
      building.x,
      building.z,
      building.rotation,
      building.y,
      kind === "output" ? building.output : building.input,
      kind === "output" ? building.input : building.output,
      stockStyleFor(nation(building), building),
      stockStanceWalkable
    );
    if (!contact) return null;
    return {
      ware,
      slot: contact.slot,
      presentation: contact.presentation,
      yaw: contact.wareYaw,
      scale: contact.scale,
      scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] },
      stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
      approach: {
        x: contact.approach[0],
        z: contact.approach[2],
        y: sampleSmooth(world, world.heights, contact.approach[0], contact.approach[2])
      }
    };
  };
};
