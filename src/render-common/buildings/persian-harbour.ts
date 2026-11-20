import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** Recipe-space hearth point within the relocated, open shore beacon chamber. */
export const PERSIAN_HARBOR_BEACON_POSITION = [-1.07, 2.18, -.68] as const;

/** An oval shore warehouse, attached vaulted loading bay and substantial rear beacon pavilion. */
export const persianHarbourRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const doorX = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const parts: BuildingPart[] = original.parts.filter(part => part.stock ||
    part.position[0] > .55 && part.position[1] < .62 &&
      ["wood", "iron", "rope", "bark", "endgrain"].includes(part.surface));
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) => parts.push({ stage: 2, ...part });
  add({ persianOpening: [(original.door[0] + .36 - .13) / 1.95,
    (original.door[0] + (original.doorDimensions?.width ?? .46) + .36 + .13) / 1.95, .19],
    position: [-.36, .69, -.10], shape: "persian-room", size: [1.95, 1.38, 1.30], stage: 1, surface: "plaster" });
  add({ position: [-.36, 1.41, -.10], shape: "cylinder", size: [1.98, .08, 1.32], surface: "plaster" });
  add({ position: [-.36, 1.45, -.10], shape: "dome", size: [1.98, 1.12, 1.32], stage: 3, surface: "roof" });
  // A deep entrance vault runs out from the oval chamber, with no classical pediment.
  for (const x of [doorX - .49, doorX + .49]) add({ position: [x, .53, .44], shape: "bevel-box",
    size: [.18, 1.06, .78], stage: 1, surface: "plaster" });
  add({ occupationRoof: "barrel", position: [doorX, 1.06 + .74 * .44, .44], shape: "occupation-roof",
    size: [1.10, .74, .78], stage: 3, surface: "roof" });
  // The existing loading equipment and its controls remain under this open vaulted bay.
  for (const x of [.55, 1.55]) for (const z of [-.52, .45]) add({ position: [x, .77, z],
    shape: "bevel-box", size: [.18, 1.54, .18], stage: 1, surface: "plaster" });
  for (const x of [.55, 1.55]) for (const z of [-.52, .45]) add({ position: [x, 1.54, z],
    shape: "bevel-box", size: [.24, .12, .24], stage: 2, surface: "plaster" });
  add({ occupationRoof: "barrel", position: [1.05, 1.54 + .72 * .44, -.035],
    shape: "occupation-roof", size: [1.10, .72, 1.23], stage: 3, surface: "roof" });
  add({ position: [1.48, .12, .78], shape: "cylinder", size: [.16, .24, .16], surface: "plaster" });
  const [x, , z] = PERSIAN_HARBOR_BEACON_POSITION;
  add({ position: [x, .07, z], shape: "cylinder", size: [.92, .14, .92], stage: 1, surface: "cut-stone" });
  add({ position: [x, 1.04, z], shape: "cylinder", size: [.82, 1.94, .82], topScale: [.88, 1, .88],
    radialSegments: detailed ? 32 : 12, stage: 1, surface: "plaster" });
  add({ position: [x, 2.025, z], shape: "cylinder", size: [.91, .10, .91], surface: "cut-stone" });
  for (const dx of [-.29, .29]) for (const dz of [-.29, .29]) add({ position: [x + dx, 2.27, z + dz],
    shape: "bevel-box", size: [.13, .46, .13], surface: "plaster" });
  add({ position: [x, 2.515, z], shape: "cylinder", size: [.94, .08, .94], surface: "plaster" });
  add({ position: [x, 2.55, z], shape: "dome", size: [.94, .66, .94], stage: 3, surface: "roof" });
  // Narrow closed observation panes are attached to the tapered shaft, well below the fire.
  for (const y of [1.15, 1.65]) add({ position: [x, y, z + .384 - (y - 1.15) * .025],
    shape: "box", size: [.095, .21, .018], surface: "dark" });
  if (detailed) for (const y of [.50, 1.28, 1.96]) add({ position: [x, y, z], shape: "ring",
    size: [.83 - y * .05, .035, .83 - y * .05], surface: "cut-stone" });
  return { ...original, harborBeacon: [...PERSIAN_HARBOR_BEACON_POSITION], parts };
};
