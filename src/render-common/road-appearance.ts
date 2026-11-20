import type { RoadTier } from "../shared/settlement/road-types";
import { STONE_MATERIAL_WARES } from "./wares/advanced-material-variants";

/** Shared presentation only; every paved tier keeps the same ribbon/contact geometry. */
export const ROAD_APPEARANCE: Record<RoadTier, { label: string; colour: string; rgb: readonly [number, number, number]; roughness: number; bump: number }> = {
  dirt: { label: "Dirt", colour: "#b98e55", rgb: [150, 111, 66], roughness: .96, bump: .045 },
  stone: { label: "Stone", colour: "#aaa99b", rgb: [139, 139, 128], roughness: .96, bump: .055 },
  marble: { label: "Marble", colour: "#eee6db", rgb: STONE_MATERIAL_WARES.marble.body.map(value => Math.round(value * 255)) as [number, number, number], roughness: .48, bump: .025 },
  limestone: { label: "Limestone", colour: "#d4b27a", rgb: STONE_MATERIAL_WARES.limestone.body.map(value => Math.round(value * 255)) as [number, number, number], roughness: .82, bump: .035 },
  // Weathered paving is lighter than raw basalt cargo, so joints and surface grain stay readable.
  basalt: { label: "Basalt", colour: "#58636f", rgb: [88, 99, 111], roughness: .88, bump: .045 },
  granite: { label: "Granite", colour: "#8f6e63", rgb: STONE_MATERIAL_WARES.granite.body.map(value => Math.round(value * 255)) as [number, number, number], roughness: .64, bump: .03 }
};
