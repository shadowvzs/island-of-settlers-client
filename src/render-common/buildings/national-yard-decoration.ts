import type { BuildingFirstNation } from "../workers/worker-unit";
import type { BuildingDefinition } from "./building-catalog";
import { type BuildingPart, type BuildingRecipe, createRomanBuildingRecipe, type Point3 } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { findFreeNationalYardSpot } from "./national-yard-sites";

type Decoration = NonNullable<BuildingPart["yardDecoration"]>;
const CHOICES: Partial<Record<BuildingFirstNation, { ids: readonly number[]; kind: Decoration; size: Point3 }>> = {
  chinese: { ids: [0, 58, 62], kind: "shrine", size: [.36, .55, .36] },
  indigenous: { ids: [0], kind: "totem", size: [.2, .75, .2] },
  maya: { ids: [0], kind: "figurine", size: [.22, .47, .2] },
};

/** Original reusable miniatures: no stock tags, animation hooks, gameplay or religious text. */
export const createNationalYardDecoration = (kind: Decoration, detailed: boolean): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) =>
    parts.push({ compactGeometry: true, stage: 4, yardDecoration: kind, ...part });
  if (kind === "totem") {
    add({ position: [0, .375, 0], shape: "national-yard-sculpture", size: [.2, .75, .2],
      decorVariant: 0, surface: "wood", worldUv: 3 });
    return parts;
  }
  if (kind === "figurine") {
    add({ position: [0, .0175, 0], shape: "bevel-box", size: [.22, .035, .2], surface: "cut-stone" });
    add({ position: [0, .2525, 0], shape: "national-yard-sculpture", size: [.22, .435, .2],
      decorVariant: 1, surface: "plaster", worldUv: 2 });
    return parts;
  }
  const red: Point3 = [.53, .14, .085], ivory: Point3 = [.87, .8, .63];
  add({ position: [0, .0225, 0], shape: "bevel-box", size: [.36, .045, .33], surface: "cut-stone" });
  for (const x of [-.115, .115]) for (const z of [-.08, .08])
    add({ position: [x, .235, z], shape: "cylinder", radialSegments: detailed ? 8 : 4,
      size: [.022, .38, .022], surface: "paint", tint: red });
  add({ position: [0, .245, -.089], shape: "box", size: [.22, .30, .035], surface: "paint", tint: ivory });
  add({ position: [0, .245, -.064], shape: "bevel-box", size: [.115, .19, .022], surface: "paint", tint: red });
  add({ position: [0, .4, 0], shape: "box", size: [.27, .045, .20], surface: "paint", tint: red });
  add({ position: [0, .465, 0], shape: "occupation-roof", occupationRoof: "hip", roofSweep: .18,
    size: [.30, .105, .36], surface: "paint", tint: [.34, .39, .35] });
  add({ position: [0, .5175, 0], shape: "bevel-box", size: [.022, .025, .22], surface: "paint", tint: [.64, .48, .25] });
  add({ position: [0, .0925, .105], shape: "cylinder", radialSegments: detailed ? 10 : 5,
    size: [.075, .095, .075], surface: "copper" });
  add({ position: [0, .144, .105], shape: "bowl", radialSegments: detailed ? 12 : 6,
    size: [.105, .045, .09], surface: "copper" });
  add({ position: [0, .152, .105], shape: "cylinder", radialSegments: detailed ? 10 : 5,
    size: [.075, .01, .06], surface: "plaster", tint: [.48, .46, .39] });
  for (const x of [-.024, 0, .024]) {
    add({ position: [x, .238, .105], shape: "cylinder", radialSegments: detailed ? 5 : 3,
      size: [.005, .175, .005], surface: "wood" });
    if (detailed) add({ position: [x, .328, .105], shape: "sphere", radialSegments: 5,
      size: [.006, .009, .006], surface: "paint", tint: [.44, .19, .07] });
  }
  return parts;
};

/** One decoration at most, and only where its complete envelope and service clearances fit. */
export const withNationalYardDecoration = (recipe: BuildingRecipe, definition: BuildingDefinition,
  nation: BuildingFirstNation, detailed: boolean): BuildingRecipe => {
  const choice = CHOICES[nation];
  if (!choice || !choice.ids.includes(definition.id) || recipe.parts.some(part => part.yardDecoration)) return recipe;
  const original = createRomanBuildingRecipe(definition, true, false);
  const limit = getRomanRecipeBounds(definition, original, false);
  const at = findFreeNationalYardSpot(recipe, definition, limit, choice.size);
  if (!at) return recipe;
  const facing = at[2] < 0 ? -1 : 1;
  const decoration = createNationalYardDecoration(choice.kind, detailed).map(part => ({ ...part,
    position: [at[0] + part.position[0] * facing, at[1] + part.position[1],
      at[2] + part.position[2] * facing] as Point3,
    rotation: facing < 0 ? [0, Math.PI, 0] as Point3 : undefined }));
  return { ...recipe, parts: [...recipe.parts, ...decoration] };
};
