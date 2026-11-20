import type { BuildingPart } from "./building-recipe";
import { addMayaFret, MAYA_PLASTER, MAYA_STONE } from "./maya-building-kit";
import { monumentRecipe } from "./monument-definition";
import type { Add } from "./nation-kit-parts";

/** A stepped limestone pyramid crowned by a compact, solid flat-roofed sanctuary. */
export const mayaMonumentRecipe = (detailed: boolean) => {
  const parts: BuildingPart[] = [];
  const add: Add = part => {
    const plainCoping = part.surface === "plaster" && part.size[1] < .1;
    parts.push({ stage: 3, worldUv: 1, ...part, surface: plainCoping ? "cut-stone" : part.surface });
  };
  const levels = detailed ? 9 : 6, totalRise = 4.15;
  for (let level = 0; level < levels; level++) {
    const width = 7.9 - level / (levels - 1) * 4.45;
    const height = totalRise / levels;
    add({ position: [0, level * height + height / 2, -.1], shape: "bevel-box",
      size: [width, height, width], topScale: [.94, 1, .94],
      stage: 1, surface: "cut-stone", tint: MAYA_STONE });
    if (!detailed) continue;
    add({ position: [0, (level + 1) * height - .025, -.1], shape: "box",
      size: [width + .025, .05, width + .025], stage: 2, surface: "plaster", tint: MAYA_PLASTER });
    for (const side of [-1, 1]) add({ position: [side * (width / 2 - .065),
      level * height + height * .43, -.1], shape: "box", size: [.13, height * .3, width - .1],
      stage: 2, surface: "plaster", tint: [.77, .74, .63] });
  }
  const steps = detailed ? 24 : 12;
  for (let step = 0; step < steps; step++) {
    const top = totalRise * (step + 1) / steps;
    add({ position: [0, top / 2, 3.92 - step * 2.55 / steps], shape: "box",
      size: [1.18, top, 2.55 / steps + .025], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
  }
  // Full-depth side masonry, a backed chamber and a real clear portal beneath a heavy lintel.
  // The low, square silhouette follows the supplied summit reference: no roof comb or pitched cap.
  add({ position: [0, totalRise + .055, -.1], shape: "box", size: [2.5, .11, 2.3],
    surface: "cut-stone", tint: MAYA_STONE });
  for (const side of [-1, 1]) add({ position: [side * .875, totalRise + .59, -.1],
    shape: "box", size: [.65, 1.08, 2.14], surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [0, totalRise + .59, -1.045], shape: "box", size: [1.1, 1.08, .25],
    surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [0, totalRise + .59, -.907], shape: "window-shadow", size: [1.1, .97, .025],
    surface: "dark", tint: [.34, .31, .25] });
  add({ position: [0, totalRise + 1.075, -.1], shape: "box", size: [2.4, .23, 2.14],
    surface: "cut-stone", tint: MAYA_STONE });
  const cornices = [[1.23, 2.56, .16, 2.3], [1.39, 2.72, .16, 2.46],
    [1.515, 2.62, .09, 2.36]] as const;
  for (const [height, width, thickness, depth] of cornices)
    add({ position: [0, totalRise + height, -.1], shape: "box", size: [width, thickness, depth],
      surface: "cut-stone", tint: MAYA_STONE });
  for (const side of [-1, 1]) addMayaFret(add, [side * .88, totalRise + .63, .984],
    .3, .52, .045, 0, detailed);
  if (detailed) for (const side of [-1, 1]) for (let panel = 0; panel < 5; panel++)
    addMayaFret(add, [side * (1.2 + panel * .43), .24, 3.82], .28, .25, .065, 0, true);
  return { ...monumentRecipe(), parts };
};
