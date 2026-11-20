import { woodWareAppearance } from "../../../render-common/wares/advanced-material-variants";
import type { createRomanMaterials } from "../buildings/roman-materials";
import { createWareModel } from "./ware-models";

export const isTimberIcon = (id: string) => id === "logs" || id === "planks" || Boolean(woodWareAppearance(id));

/** Keep the cut ends readable; cedar uses a closer crop of the longer cuts. */
export const createTimberIconModel = (
  id: string, materials: ReturnType<typeof createRomanMaterials>["materials"]
) => {
  const cedar = id === "cedarLogs" || id === "cedarPlanks";
  const closeUpLog = id === "logs" || id === "planks" || cedar;
  let framingMargin = 1.08;
  if (closeUpLog) framingMargin = .62;
  if (cedar) framingMargin = .80;
  return {
    ...createWareModel(id, true, materials),
    recipe: { closeUpLog, framingMargin, tightFraming: true, tool: false }
  };
};
