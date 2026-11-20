import type { BuildingPart, Point3 } from "../building-recipe";
import { boxOf, heightCap, isFree, type LevelKit } from "./level-kit";
import { addWallStandard } from "./level-wall-standard";

/** Small national roof fittings follow the actual surface and remain subordinate to each occupation. */
export const addExpansionCrown = (kit: LevelKit) => {
  if (kit.site.nation === "maya" && kit.site.definition.id === 0) { addWallStandard(kit); return; }
  const roof = kit.site.roof;
  if (!roof) return;
  const [x, , z] = roof.centre, surface = kit.site.topAt(x, z);
  if (surface === null || surface + .32 > heightCap(kit.site)) return;
  const centre: Point3 = [x, surface + .16, z];
  const clear = isFree(kit.site, boxOf(centre, [.35, .28, .24]), .005,
    bounds => bounds.max[1] <= surface + .035);
  if (!clear) return;
  const add = (part: Omit<BuildingPart, "stage">) => kit.add({ compactGeometry: true, stage: 4, ...part });
  if (kit.site.nation === "persian") {
    add({ position: [x, surface + .065, z], radialSegments: kit.detailed ? 12 : 6,
      shape: "cylinder", size: [.28, .13, .28], surface: "plaster" });
    add({ position: [x, surface + .13, z], shape: "dome", size: [.3, .29, .3], surface: "roof" });
    return;
  }
  if (kit.site.nation === "maya") {
    add({ position: [x, surface + .035, z], shape: "box", size: [.42, .07, .18], surface: "cut-stone" });
    for (const side of [-1, 1]) add({ position: [x + side * .145, surface + .17, z],
      shape: "bevel-box", size: [.1, .22, .11], surface: "cut-stone" });
    add({ position: [x, surface + .285, z], shape: "bevel-box", size: [.4, .05, .13], surface: "cut-stone" });
    return;
  }
  // Chinese: a broad ridge saddle, a short tiled ventilation hood and modeled upturned ridge ends.
  add({ position: [x, surface + .035, z], shape: "box", size: [.34, .07, .22], surface: "wood" });
  add({ position: [x, surface + .13, z], shape: "box", size: [.22, .13, .14], surface: "paint",
    tint: [.46, .16, .1] });
  add({ occupationRoof: "hip", position: [x, surface + .22, z], shape: "occupation-roof",
    size: [.39, .12, .26], surface: "roof" });
  for (const side of [-1, 1]) add({ position: [x + side * .16, surface + .27, z],
    rotation: [0, 0, side * -.3], shape: "bevel-box", size: [.08, .09, .07], surface: "roof" });
};
