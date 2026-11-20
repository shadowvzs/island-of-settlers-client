import type { MeshStandardMaterial } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { createWareModel } from "./ware-models";

/** Icons frame the same single ingot used for production stock and carried iron. */
export const createIronBarIconModel = (materials: Record<BuildingSurface, MeshStandardMaterial>) => ({
  ...createWareModel("iron", true, materials),
  recipe: { framingMargin: 1.035, tightFraming: true, tool: false }
});
