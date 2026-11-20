import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { createOpeningShadowDisk } from "./building-window-shadows";

/** An open Persian cistern pavilion: oval wellhead, four heavy piers and a long masonry vault. */
export const persianWellRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock ||
    part.surface === "dark" && !!part.windowShadowContour ||
    part.surface === "wood" && part.position[1] === 1.04);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (!part.stock && part.surface === "dark" && part.windowShadowContour)
      parts[index] = createOpeningShadowDisk({ ...part, windowShadow: undefined,
        position: [part.position[0], .017, part.position[2]],
        size: [part.size[0], .034, part.size[2]] }, detailed);
  }
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) => parts.push({ stage: 2, ...part });
  add({ position: [-.03, .125, -.75], radialSegments: detailed ? 32 : 12,
    shape: "bowl", size: [.66, .25, .52], stage: 1, surface: "plaster" });
  add({ position: [-.03, .245, -.75], radialSegments: detailed ? 32 : 12,
    shape: "ring", size: [.675, .035, .535], surface: "paint", tint: [.035, .08, .38] });
  add({ position: [-.03, .02, -.75], shape: "cylinder", size: [.48, .04, .36], surface: "cut-stone" });
  if (detailed) for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    add({ position: [-.03 + Math.sin(angle) * .317, .255, -.75 + Math.cos(angle) * .247],
      radialSegments: 6, shape: "sphere", size: [.055, .025, .055], surface: "plaster" });
  }
  add({ persianOpening: [0, 0, -.5], position: [0, .42, -.15], shape: "persian-room",
    size: [.80, .50, .70], stage: 1, surface: "plaster" });
  for (const y of [.19, .66]) add({ persianOpening: [0, 0, -.5], position: [0, y, -.15],
    shape: "persian-room", size: [.84, .065, .74], stage: 1, surface: "cut-stone" });
  // Corner piers leave the windlass, crank sweep and bucket route exposed on both sides.
  for (const x of [-.455, .455]) for (const z of [-.56, .26]) {
    add({ position: [x, .53, z], shape: "bevel-box", size: [.13, 1.06, .14], surface: "plaster" });
    add({ position: [x, 1.105, z], shape: "bevel-box", size: [.16, .09, .19], surface: "cut-stone" });
  }
  // Eave beams carry the real barrel spring feet, including its .06 normalized underside drop.
  const spring = 1.25, rise = .66, beamTop = spring - .06 * rise + .004;
  for (const x of [-.48, .48]) add({ position: [x, beamTop - .04, -.15], shape: "bevel-box",
    size: [.10, .08, 1.05], surface: "plaster" });
  // Exact original axle bearings remain at their canonical z coordinates.
  for (const z of [-.6, .3]) add({ position: [0, .795, z], shape: "bevel-box",
    size: [.075, 1.23, .075], surface: "wood" });
  add({ occupationRoof: "barrel", position: [0, 1.25 + .66 * .44, -.15], radialSegments: detailed ? 16 : 6, shape: "occupation-roof",
    size: [1.02, .66, 1.05], stage: 3, surface: "roof" });
  if (detailed) for (const z of [-.48, -.15, .18]) add({ occupationRoof: "barrel",
    position: [0, 1.25 + .675 * .44, z], radialSegments: detailed ? 16 : 6, shape: "occupation-roof", size: [1.025, .675, .035],
    stage: 3, surface: "cut-stone" });
  return { ...original, parts };
};
