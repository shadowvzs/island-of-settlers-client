import type { BuildingFirstNation } from "../workers/worker-unit";
import { getBuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import { type Add } from "./nation-kit-parts";


const basket = (add: Add, x: number, z: number, detailed: boolean) => {
  add({ position: [x, .115, z], radialSegments: detailed ? 14 : 6, shape: "cylinder",
    size: [.23, .22, .23], stage: 3, surface: "straw", topScale: [1.12, 1, 1.12] });
  add({ position: [x, .23, z], radialSegments: detailed ? 16 : 6, shape: "ring",
    size: [.265, .035, .265], stage: 3, surface: "rope" });
  add({ position: [x, .222, z], radialSegments: detailed ? 12 : 5, shape: "cylinder",
    size: [.205, .007, .205], stage: 3, surface: "dark" });
};

const table = (add: Add, x: number, z: number) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({
    position: [x + sx * .23, .21, z + sz * .12], shape: "box", size: [.035, .42, .035],
    stage: 2, surface: "wood"
  });
  add({ position: [x, .435, z], shape: "bevel-box", size: [.55, .04, .34], stage: 2, surface: "planks" });
};

const teaNursery = (add: Add, detailed: boolean) => {
  for (const z of [-.53, -.07]) {
    // Four joined boards enclose a substantial soil bed; there is no flat painted lid.
    for (const side of [-1, 1]) {
      add({ position: [.94 + side * .235, .075, z], shape: "bevel-box", size: [.025, .15, .31],
        stage: 1, surface: "planks" });
      add({ position: [.94, .075, z + side * .142], shape: "bevel-box", size: [.45, .15, .025],
        stage: 1, surface: "planks" });
    }
    add({ position: [.94, .105, z], shape: "planting-soil", size: [.44, .065, .26],
      stage: 1, surface: "bark", tint: [.58, .45, .3] });
    for (const side of [-1, 1]) for (const part of ["bark", "leaves"] as const)
      add({ position: [.94 + side * .112, .315, z], shape: `tea-${part}`,
        size: [.25, .39, .24], stage: part === "bark" ? 2 : 3,
        surface: part === "bark" ? "bark" : "leaf" });
  }
  basket(add, 1.13, .63, detailed);
  add({ position: [.85, .055, .49], shape: "bowl", size: [.3, .09, .24], stage: 3, surface: "straw" });
  if (detailed) for (let leaf = 0; leaf < 5; leaf++) add({
    position: [.76 + leaf * .04, .09, .49], rotation: [0, leaf * .5, .15], shape: "harvested-tea-leaf",
    size: [.035, .012, .075], stage: 3, surface: "leaf"
  });
};

const pomegranateNursery = (add: Add, detailed: boolean) => {
  const surfaces = { bark: "bark", leaves: "leaf", fruit: "paint" } as const;
  for (const part of ["bark", "leaves", "fruit"] as const) add({
    position: [.95, .48, -.36], shape: `pomegranate-${part}`, size: [.76, .96, .76],
    stage: part === "bark" ? 2 : 3, surface: surfaces[part]
  });
  table(add, .96, .38);
  add({ position: [.94, .49, .38], shape: "bowl", size: [.28, .07, .23], stage: 3, surface: "straw" });
  for (let index = 0; index < (detailed ? 4 : 2); index++) add({ position: [.86 + index * .055, .53, .38],
    shape: "pomegranate-whole-fruit", size: [.065, .065, .065],
    stage: 3, surface: "paint" });
};

const cacaoNursery = (add: Add, detailed: boolean) => {
  const surfaces = { bark: "bark", leaves: "leaf", pods: "paint" } as const;
  for (const z of [-.58, -.08]) {
    for (const part of ["bark", "leaves", "pods"] as const) add({
      position: [.97, .42, z], shape: `cacao-${part}`, size: [.57, .84, .57],
      stage: part === "bark" ? 2 : 3, surface: surfaces[part]
    });
  }
  add({ position: [.98, .025, .48], shape: "box", size: [.53, .035, .39], stage: 3, surface: "straw" });
  for (let index = 0; index < (detailed ? 12 : 5); index++) add({
    position: [.78 + index % 4 * .11, .055, .37 + Math.floor(index / 4) * .09],
    rotation: [0, index * .45, 0], radialSegments: detailed ? 6 : 4, shape: "sphere",
    size: [.045, .025, .065], stage: 3, surface: "paint", tint: [.31, .17, .085]
  });
  // Keep the entire basket inside the authored envelope: the old x=1.29 clipped its body/rim
  // while its narrower dark interior survived as a floating disc.
  basket(add, 1.12, .61, detailed);
};

const berryNursery = (add: Add, detailed: boolean) => {
  const surfaces = { bark: "bark", leaves: "leaf", fruit: "paint" } as const;
  for (const z of [-.5, .02]) for (const part of ["bark", "leaves", "fruit"] as const)
    add({ position: [.94, .27, z], shape: `berry-${part}`, size: [.51, .54, .48],
      stage: part === "bark" ? 2 : 3, surface: surfaces[part] });
  basket(add, 1.1, .58, detailed);
  add({ position: [.82, .04, .49], shape: "bowl", size: [.23, .065, .21], stage: 3, surface: "straw" });
};

const YARDS = { chinese: teaNursery, indigenous: berryNursery, maya: cacaoNursery, persian: pomegranateNursery };

/** New drink grower yards replace only the former vineyard's east-side trellises and loose decor. */
export const decorateExpansionDrinkProducer = (recipe: BuildingRecipe, id: number,
  nation: BuildingFirstNation, detailed: boolean): BuildingRecipe => {
  if (id !== 5) return recipe;
  const parts = recipe.parts.filter(part => part.stock || part.position[0] <= .55);
  const limit = getRomanBuildingWorldSizing(getBuildingDefinition(5)).bounds;
  const add: Add = part => {
    const built: BuildingPart = { compactGeometry: true, stage: 3, ...part };
    const bounds = getRomanPartBounds(built);
    if (Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) > limit.extentX + .0001 ||
      Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) > limit.extentZ + .0001) return;
    parts.push(built);
  };
  YARDS[nation](add, detailed);
  return { ...recipe, parts };
};
