import type { Point3 } from "./building-recipe";
import type { TowerPlan } from "./military-tower-plan";
import { type Add, runBetween } from "./nation-kit-parts";

/** Open fighting landings have real hatch access, guard rails and visible pegged timber joints. */
export const addIndigenousFortressDeck = (add: Add, plan: TowerPlan, detailed: boolean) => {
  const { deck, depth, width, x, z } = plan;
  const beam = (from: Point3, to: Point3, thickness = .035) =>
    runBetween(add, from, to, [thickness, thickness], { stage: 2, surface: "wood" });
  const rows = detailed ? 12 : 7, hatchZ = z - depth * .25;
  for (let row = 0; row < rows; row++) {
    const centreZ = z - depth / 2 + (row + .5) * depth / rows;
    const hatch = Math.abs(centreZ - hatchZ) < .095 + depth / rows / 2;
    const plank = (centreX: number, span: number) => add({ position: [centreX, deck - .03, centreZ],
      shape: "box", size: [span, .06, depth / rows * .97], stage: 2, surface: "planks" });
    if (!hatch) plank(x, width);
    else for (const side of [-1, 1]) plank(x + side * (width + .20) / 4, (width - .20) / 2);
  }
  // Four bearers meet the concealed frame directly below the plank floor.
  for (const side of [-1, 1]) {
    beam([x - width * .27, deck - .07, z + side * depth * .27],
      [x + width * .27, deck - .07, z + side * depth * .27], .07);
    beam([x + side * width * .27, deck - .07, z - depth * .27],
      [x + side * width * .27, deck - .07, z + depth * .27], .07);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * width * .43, pz = z + sz * depth * .43;
    beam([px, deck - .055, pz], [px, deck + .32, pz], .045);
    if (detailed) add({ position: [px, deck + .235, pz], shape: "ring",
      size: [.065, .025, .065], radialSegments: 6, stage: 3, surface: "rope" });
  }
  for (const side of [-1, 1]) {
    beam([x - width * .43, deck + .25, z + side * depth * .43],
      [x + width * .43, deck + .25, z + side * depth * .43]);
    beam([x + side * width * .43, deck + .25, z - depth * .43],
      [x + side * width * .43, deck + .25, z + depth * .43]);
  }
  // The ladder stays inside the covered body and emerges through its own real floor opening.
  for (const side of [-1, 1]) beam([x + side * .082, .025, hatchZ],
    [x + side * .082, deck + .14, hatchZ], .025);
  const rungs = Math.ceil(deck / (detailed ? .16 : .25));
  for (let rung = 1; rung < rungs; rung++) beam([x - .092, deck * rung / rungs, hatchZ],
    [x + .092, deck * rung / rungs, hatchZ], .018);
};
