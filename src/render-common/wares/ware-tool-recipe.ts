import type { BuildingPart } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";
import { spyglassParts } from "./spyglass-parts";
import type { WareId } from "./ware-catalog";

/** Grip origin and vertical haft are suitable for existing exported worker contact clips. */
const getBowStaveCount = (detailed: boolean, compactStock: boolean) => {
  if (detailed) return 10;
  return compactStock ? 3 : 5;
};

export const addWareTool = (part: AddPart, id: WareId, detailed: boolean, compactStock = false) => {
  if (id === "spyglass") {
    for (const piece of spyglassParts(detailed && !compactStock))
      part(piece.surface, piece.position, piece.size, piece.stage, piece.shape, piece.rotation, piece.tint);
    return;
  }
  if (id === "shield") {
    part("wood", [0, 0, 0], [0.25, 0.36, 0.05], 3, "sphere");
    part("steel", [0, 0, 0.025], [0.075, 0.075, 0.03], 3, "sphere");
    return;
  }
  if (id === "crucible") {
    part("iron", [0, 0, 0], [0.16, 0.18, 0.16], 3, "ring");
    part("iron", [0, -0.08, 0], [0.15, 0.02, 0.15], 3, "cylinder");
    return;
  }
  if (id === "bow") {
    const count = getBowStaveCount(detailed, compactStock);
    for (let i = 0; i < count; i++) {
      const y = -0.25 + ((i + 0.5) * 0.5) / count;
      part(
        "wood",
        [0.065 * (1 - (y / 0.25) ** 2), y, 0],
        [0.018, 0.5 / count + 0.006, 0.018],
        3,
        "cord",
        [0, 0, y * 0.9]
      );
    }
    part("rope", [0, 0, 0], [0.005, 0.5, 0.005], 3, "cord");
    return;
  }
  if (id === "tongs") {
    for (const side of [-1, 1])
      part("steel", [side * 0.025, 0.02, 0], [0.017, 0.35, 0.017], 3, "cord", [0, 0, side * 0.13]);
    part("steel", [0, 0.03, 0], [0.035, 0.035, 0.024], 3, "sphere");
    return;
  }
  if (id === "rollingPin") {
    part("wood", [0, 0, 0], [0.065, 0.28, 0.065], 3, "cylinder");
    for (const side of [-1, 1])
      part("wood", [0, side * 0.18, 0], [0.025, 0.1, 0.025], 3, "cylinder");
    return;
  }
  const length = ["scythe", "fishingRod", "shovel"].includes(id) ? 0.62 : 0.43;
  part("wood", [0, 0.09, 0], [0.025, length, 0.025], 3, "cord");
  if (id === "axe") part("steel", [0.06, 0.29, 0], [0.19, 0.14, 0.026], 3, "axe-head");
  else if (id === "pickaxe") {
    for (const side of [-1, 1]) {
      part("steel", [side * 0.065, 0.3, 0], [0.15, 0.035, 0.037], 3, "bevel-box", [
        0,
        0,
        side * -0.18
      ]);
      if (compactStock && !detailed) continue;
      part("steel", [side * 0.15, 0.275, 0], [0.08, 0.019, 0.025], 3, "bevel-box", [
        0,
        0,
        side * -0.36
      ]);
    }
  } else if (id === "hammer") part("steel", [0, 0.29, 0], [0.13, 0.057, 0.054], 3, "bevel-box");
  else if (id === "shovel") part("steel", [0, -0.18, 0], [0.12, 0.16, 0.025], 3, "sphere");
  else if (id === "scythe") part("steel", [-0.13, 0.35, 0], [0.34, 0.22, 0.02], 3, "scythe-blade");
  else if (id === "fishingRod") {
    part("rope", [0.07, 0.1, 0], [0.003, 0.55, 0.003], 3, "cord", [0, 0, 0.25]);
    part("steel", [0.13, -0.16, 0], [0.024, 0.035, 0.012], 3, "sphere");
  } else if (id === "sword") {
    part("steel", [0, 0.28, 0], [0.055, 0.38, 0.018], 3, "bevel-box");
    part("gold", [0, 0.08, 0], [0.12, 0.025, 0.024], 3);
  } else {
    const size: BuildingPart["size"] = id === "cleaver" ? [0.17, 0.12, 0.022] : [0.21, 0.11, 0.022];
    part("steel", [0.055, 0.26, 0], size, 3, "bevel-box");
    if (id === "saw" && detailed)
      for (let i = 0; i < 7; i++)
        part("steel", [-0.028 + i * 0.027, 0.195, 0], [0.026, 0.025, 0.024], 3, "box", [
          0,
          0,
          Math.PI / 4
        ]);
  }
};
