/** Approved colony material families share measured geometry, with distinct bark/heartwood/stone finishes. */
const WOOD_MATERIAL_WARES = {
  hardwoodLogs: { source: "logs", base: "hardwoodLogs", tint: [1, 1, 1], roughness: undefined },
  hardwoodPlanks: { source: "planks", base: "hardwoodPlanks", tint: [1, 1, 1], roughness: undefined },
  cedarLogs: { source: "logs", base: "hardwoodLogs", tint: [1.2, 1.02, .72], roughness: .94 },
  cedarPlanks: { source: "planks", base: "hardwoodPlanks", tint: [1.2, 1.02, .72], roughness: .94 },
  walnutLogs: { source: "logs", base: "hardwoodLogs", tint: [.58, .48, .4], roughness: .82 },
  walnutPlanks: { source: "planks", base: "hardwoodPlanks", tint: [.58, .48, .4], roughness: .82 },
  mahoganyLogs: { source: "logs", base: "hardwoodLogs", tint: [1, .58, .43], roughness: .72 },
  mahoganyPlanks: { source: "planks", base: "hardwoodPlanks", tint: [1, .58, .43], roughness: .72 }
} as const;
export const STONE_MATERIAL_WARES = {
  marble: { tint: [1, 1, 1], body: [.96, .95, .9], seam: [.43, .49, .48], roughness: .75 },
  limestone: { tint: [.88, .68, .40], body: [.83, .70, .48], seam: [.62, .46, .27], roughness: .94 },
  basalt: { tint: [.065, .085, .115], body: [.085, .105, .13], seam: [.22, .27, .32], roughness: .96 },
  granite: { tint: [.60, .43, .38], body: [.56, .43, .39], seam: [.33, .29, .28], roughness: .87 }
} as const;
export type MaterialWoodWare = keyof typeof WOOD_MATERIAL_WARES;
export type MaterialStoneWare = keyof typeof STONE_MATERIAL_WARES;
export const woodWareAppearance = (ware: string) =>
  Object.hasOwn(WOOD_MATERIAL_WARES, ware) ? WOOD_MATERIAL_WARES[ware as MaterialWoodWare] : undefined;
export const stoneWareAppearance = (ware: string) =>
  Object.hasOwn(STONE_MATERIAL_WARES, ware) ? STONE_MATERIAL_WARES[ware as MaterialStoneWare] : undefined;
export const isMaterialWare = (ware: string) => !!woodWareAppearance(ware) || !!stoneWareAppearance(ware);
