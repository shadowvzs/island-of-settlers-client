import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** Broad stepped oval residence; no inherited rectangular storey slabs or floating window boxes. */
export const persianGrandResidence = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock);
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) => parts.push({ stage: 2, ...part });
  add({ persianOpening: [-.12, .12, .30], position: [0, .575, -.36], shape: "persian-room",
    size: [3.12, 1.15, 1.72], stage: 1, surface: "plaster" });
  add({ persianOpening: [0, 0, -.5], position: [0, 1.46, -.40], shape: "persian-room",
    size: [2.38, .68, 1.35], stage: 1, surface: "plaster" });
  add({ position: [0, 1.82, -.4], shape: "cylinder", size: [2.43, .065, 1.40], surface: "plaster" });
  add({ position: [0, 1.85, -.4], shape: "dome", size: [2.43, 1.2, 1.4], stage: 3, surface: "roof" });
  // Low oval side chambers give the family house two differently scaled wings.
  for (const x of [-1.20, 1.20]) {
    add({ persianOpening: [0, 0, -.5], position: [x, .59, -.35], shape: "persian-room",
      size: [.82, 1.18, 1.4], stage: 1, surface: "plaster" });
    add({ position: [x, 1.20, -.35], shape: "dome", size: [.86, .65, 1.44], stage: 3, surface: "roof" });
  }
  for (const x of [-.48, .48]) add({ position: [x, .48, .50], shape: "bevel-box",
    size: [.16, .96, .80], stage: 1, surface: "plaster" });
  add({ occupationRoof: "barrel", position: [0, .96 + .72 * .44, .50], shape: "occupation-roof",
    size: [1.12, .72, .80], stage: 3, surface: "roof" });
  for (const x of [-1.20, 1.20]) add({ position: [x, .63, .362], shape: "box", size: [.15, .25, .025], surface: "dark" });
  for (const x of detailed ? [-.72, .72] : [0]) add({ position: [x, 1.48, -.40 + Math.sqrt(1 - (x / 1.19) ** 2) * .675 + .01],
    rotation: [0, Math.asin(x / 1.19), 0], shape: "box",
    size: [.13, .23, .025], surface: "dark" });
  if (detailed) for (const x of [-1.1, 1.1]) {
    add({ position: [x, .035, .54], shape: "bevel-box", size: [.38, .07, .23], surface: "cut-stone" });
    add({ position: [x, .15, .54], shape: "clay-jar", size: [.15, .23, .15], surface: "plaster" });
  }
  return { ...original, parts };
};
