import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { createOpeningShadowDisk } from "./building-window-shadows";
import { type Add, runBetween } from "./nation-kit-parts";

/** Open working shaft: rough gathered boulders and a windlass frame share the ordinary draw contacts. */
export const indigenousOpenWellParts = (original: BuildingRecipe, detailed: boolean): BuildingPart[] => {
  const parts = original.parts.filter(part => part.stock), z = original.mechanism[2];
  const axleY = original.mechanism[1], frameTop = axleY + .18;
  const add: Add = part => parts.push({ compactGeometry: true, stage: 2, ...part });
  add(createOpeningShadowDisk({ position: [-.03, .025, z], shape: "cylinder",
    size: [.50, .018, .50], stage: 1, surface: "dark" }, detailed));
  // Three staggered rubble courses: every exposed face is real stone, with no smooth annular core.
  for (let row = 0; row < (detailed ? 3 : 2); row++) for (let index = 0; index < 10; index++) {
    const angle = (index + row * .48) * Math.PI / 5;
    const jitter = Math.sin(index * 7.1 + row * 3.7);
    const radius = .327 + jitter * .006;
    const height = (detailed ? .21 : .30) + Math.cos(index * 4.7 + row) * .012;
    const bottom = row * (detailed ? .16 : .235);
    add({ decorVariant: row * 10 + index, position: [-.03 + DMath.sin(angle) * radius,
      bottom + height / 2, z + DMath.cos(angle) * radius], rotation: [0, angle + jitter * .14, 0],
      shape: "structural-rock", size: [.27 + jitter * .014, height, .245], stage: 1, surface: "stone" });
    const jointAngle = angle + Math.PI / 10;
    if (detailed || index % 2 === 0) add({ decorVariant: 40 + row * 10 + index, position: [-.03 + DMath.sin(jointAngle) * .327,
      bottom + height / 2 + jitter * .008, z + DMath.cos(jointAngle) * .327],
    rotation: [jitter * .08, jointAngle + .12, 0], shape: "structural-rock",
    size: [.115, .155, .23], stage: 1, surface: "stone" });
    if (detailed && row > 0) add({ decorVariant: 80 + row * 10 + index,
      position: [-.03 + DMath.sin(angle) * .327, bottom + .006, z + DMath.cos(angle) * .327],
      rotation: [0, angle - .09, jitter * .08], shape: "structural-rock",
      size: [.15, .085, .23], stage: 1, surface: "stone" });
  }
  for (const postZ of [z - .45, z + .45]) {
    add({ position: [0, frameTop / 2, postZ], shape: "cylinder", size: [.11, frameTop, .11],
      radialSegments: detailed ? 9 : 5, surface: "bark" });
    add({ position: [0, axleY + .005, postZ], shape: "ring", rotation: [Math.PI / 2, 0, 0],
      radialSegments: detailed ? 10 : 5, size: [.155, .09, .155], surface: "wood" });
    for (const side of detailed ? [-1, 1] : [-1]) runBetween(add, [0, axleY - .18, postZ], [side * .17, frameTop, postZ], [.035, .04],
      { stage: 2, surface: "wood" });
  }
  return parts;
};
