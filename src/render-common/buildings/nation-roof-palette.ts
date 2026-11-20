import type { BuildingPart, Point3 } from "./building-recipe";

/**
 * Japanese building ranks: grand and military
 * halls (vermilion soffit and rafters, gold ridge ornaments), farmsteads (copper) and workshops
 * (kawara). Owner decision 2026-10-12: every rank shares the one dark blue-grey kawara roof colour
 * (NATION_ROOF_COLOURS), so the rank only styles the eaves and ornaments.
 */
export type JapaneseRoofClass = "vermilion" | "copper" | "kawara";
const VERMILION = new Set([0, 1, 2, 4, 9, 14, 29, 34, 39]);
const COPPER = new Set([5, 6, 28, 31, 37]);
/** Neutral: the tiles take the nation roof colour from their material, never a per-rank hue. */
const NATION_ROOF_TINT: Point3 = [1, 1, 1];
export const JAPANESE_ROOF_TINTS: Readonly<Record<JapaneseRoofClass, Point3>> = {
  copper: NATION_ROOF_TINT, kawara: NATION_ROOF_TINT, vermilion: NATION_ROOF_TINT
};

export const japaneseRoofClass = (typeId: number): JapaneseRoofClass => {
  if (VERMILION.has(typeId)) return "vermilion";
  return COPPER.has(typeId) ? "copper" : "kawara";
};

/** Soffit under the eaves: vermilion halls show red rafters on white boards, others dark timber. */
const SOFFIT: Readonly<Record<JapaneseRoofClass, { board: Partial<BuildingPart>; rafters: Partial<BuildingPart> }>> = {
  copper: { board: { surface: "wood", tint: [.62, .44, .34] }, rafters: { surface: "wood", tint: [.95, .78, .6] } },
  kawara: { board: { surface: "wood", tint: [.6, .42, .32] }, rafters: { surface: "wood", tint: [.95, .76, .58] } },
  // Warm boards and bright rafters stay readable in the eave shade and under green ground light.
  vermilion: { board: { surface: "plaster", tint: [1.18, .92, .8] }, rafters: { surface: "plaster", tint: [1.5, .28, .16] } }
};

/**
 * The parts drawn under a Japanese roof: its soffit board and (High) the exposed rafters, with
 * the roof's own placement. The tiled roof part itself draws no underside.
 */
export const japaneseRoofUnderside = (roof: BuildingPart, roofClass: JapaneseRoofClass, detailed: boolean) => {
  const look = SOFFIT[roofClass];
  const layer = (roofLayer: "soffit" | "rafters", style: Partial<BuildingPart>): BuildingPart =>
    ({ ...roof, ...style, roofLayer, position: [...roof.position] as Point3, size: [...roof.size] as Point3 });
  return detailed ? [layer("soffit", look.board), layer("rafters", look.rafters)] : [layer("soffit", look.board)];
};
