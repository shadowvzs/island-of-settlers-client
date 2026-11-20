import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { BuildingLevel } from "./levels/building-level";
import { isRoofCovering, roofTopAt } from "./levels/level-roof-surface";
import { addRoofVentWindow } from "./levels/level-roof-vent";
import { redesignOccupationRoof } from "./occupation-roof-redesign";

export type RoofReviewFunction = "woodland" | "nursery" | "timber" | "textile" | "bakery"
  | "tower" | "hall" | "farm" | "storage" | "civic";
type RoofForm = NonNullable<BuildingPart["occupationRoof"]> | "flat";
type RoofFamily = Readonly<{
  form: RoofForm;
  material: BuildingSurface;
  support: BuildingSurface;
  sweep?: number;
  curve?: number;
  panCover?: boolean;
}>;
type RoofVocabulary = Readonly<Record<string, RoofFamily>>;

/** Proposed vocabulary, not production approval. Existing nation paint/material packs are reused;
 * reference photographs are never runtime textures. Maya adds only the vented half-hip form. */
export const ROOF_REVIEW_VOCABULARY = {
  roman: {
    "tegula-gable": { form: "gable", material: "roof", support: "wood" },
    "tegula-hip": { form: "hip", material: "roof", support: "stone" },
    "timber-gable": { form: "gable", material: "planks", support: "wood" },
    "reed-hip": { form: "hip", material: "straw", support: "wood" }
  },
  viking: {
    "shingle-gable": { form: "gable", material: "roof", support: "wood" },
    "thatch-half-hip": { form: "half-hip", material: "straw", support: "bark" },
    "stone-hood": { form: "gable", material: "stone", support: "stone" }
  },
  nubian: {
    "earth-vault": { form: "barrel", material: "roof", support: "plaster" },
    "reed-hip": { form: "hip", material: "straw", support: "wood" },
    "earth-hip": { form: "hip", material: "roof", support: "plaster" }
  },
  japanese: {
    "kawara-kirizuma": { form: "gable", material: "roof", support: "wood", sweep: .06, curve: .12 },
    "kawara-yosemune": { form: "hip", material: "roof", support: "wood", sweep: .08, curve: .18 },
    "thatch-koshiyori": { form: "half-hip", material: "straw", support: "wood" }
  },
  maya: {
    "existing-thatch-hip": { form: "hip", material: "straw", support: "wood" },
    "existing-stone-flat": { form: "flat", material: "cut-stone", support: "cut-stone" },
    "vented-thatch-half-hip": { form: "half-hip", material: "straw", support: "wood" }
  },
  persian: {
    "earth-barrel": { form: "barrel", material: "roof", support: "plaster" },
    "timber-gable": { form: "gable", material: "planks", support: "wood" },
    "earth-hip": { form: "hip", material: "roof", support: "plaster" }
  },
  chinese: {
    "reed-hip": { form: "hip", material: "straw", support: "wood" },
    "tile-yingshan": { form: "gable", material: "roof-slate", support: "wood",
      sweep: .12, curve: .35, panCover: true },
    "tile-xieshan": { form: "half-hip", material: "roof-slate", support: "wood",
      sweep: .15, curve: .4, panCover: true },
    "tile-wudian": { form: "hip", material: "roof-slate", support: "wood",
      sweep: .16, curve: .4, panCover: true }
  },
  indigenous: {
    "hide-ridge-hood": { form: "half-hip", material: "cloth-hide-trim", support: "bark" },
    "canvas-ridge-hood": { form: "gable", material: "cloth-patched", support: "bark" },
    "stone-smoke-hood": { form: "hip", material: "stone", support: "stone" }
  }
} as const satisfies Readonly<Record<WorkerNation, RoofVocabulary>>;

type FunctionMap<N extends WorkerNation> = Readonly<Record<RoofReviewFunction,
  keyof typeof ROOF_REVIEW_VOCABULARY[N]>>;
type NationFunctionMap = { readonly [N in WorkerNation]: FunctionMap<N> };

/** Function selection is shared by both LODs and every instance. Unused functions are proposals
 * for review only; the transform below deliberately touches just the five civilian candidates. */
export const ROOF_REVIEW_FUNCTIONS = {
  roman: { woodland: "timber-gable", nursery: "timber-gable", timber: "tegula-gable",
    textile: "tegula-hip", bakery: "tegula-gable", tower: "tegula-hip", hall: "tegula-hip",
    farm: "reed-hip", storage: "tegula-gable", civic: "tegula-hip" },
  viking: { woodland: "shingle-gable", nursery: "thatch-half-hip", timber: "shingle-gable",
    textile: "shingle-gable", bakery: "stone-hood", tower: "shingle-gable", hall: "shingle-gable",
    farm: "thatch-half-hip", storage: "shingle-gable", civic: "shingle-gable" },
  nubian: { woodland: "reed-hip", nursery: "reed-hip", timber: "earth-vault",
    textile: "earth-hip", bakery: "earth-vault", tower: "earth-hip", hall: "earth-vault",
    farm: "reed-hip", storage: "earth-vault", civic: "earth-hip" },
  japanese: { woodland: "kawara-kirizuma", nursery: "thatch-koshiyori", timber: "kawara-kirizuma",
    textile: "kawara-yosemune", bakery: "kawara-kirizuma", tower: "kawara-yosemune", hall: "kawara-yosemune",
    farm: "thatch-koshiyori", storage: "kawara-kirizuma", civic: "kawara-yosemune" },
  maya: { woodland: "vented-thatch-half-hip", nursery: "existing-thatch-hip",
    timber: "vented-thatch-half-hip", textile: "vented-thatch-half-hip", bakery: "existing-stone-flat",
    tower: "existing-stone-flat", hall: "existing-stone-flat", farm: "existing-thatch-hip",
    storage: "existing-thatch-hip", civic: "existing-stone-flat" },
  persian: { woodland: "timber-gable", nursery: "timber-gable", timber: "earth-barrel",
    textile: "earth-hip", bakery: "earth-barrel", tower: "earth-hip", hall: "earth-hip",
    farm: "timber-gable", storage: "earth-barrel", civic: "earth-hip" },
  chinese: { woodland: "tile-yingshan", nursery: "tile-xieshan", timber: "tile-yingshan",
    textile: "tile-xieshan", bakery: "tile-yingshan", tower: "tile-wudian", hall: "tile-wudian",
    farm: "reed-hip", storage: "tile-yingshan", civic: "tile-wudian" },
  indigenous: { woodland: "hide-ridge-hood", nursery: "hide-ridge-hood", timber: "canvas-ridge-hood",
    textile: "canvas-ridge-hood", bakery: "stone-smoke-hood", tower: "hide-ridge-hood", hall: "canvas-ridge-hood",
    farm: "hide-ridge-hood", storage: "canvas-ridge-hood", civic: "canvas-ridge-hood" }
} as const satisfies NationFunctionMap;

const BUILDING_FUNCTION: Readonly<Partial<Record<number, RoofReviewFunction>>> = {
  18: "farm", 22: "farm", 17: "woodland", 20: "nursery", 33: "timber", 61: "textile", 32: "bakery", 8: "textile"
};
export const ROOF_REVIEW_EXCLUDED_TYPES = [0, 7, 1, 2, 4, 9, 40, 62, 16, 31] as const;
const EXCLUDED = new Set<number>(ROOF_REVIEW_EXCLUDED_TYPES);

export const roofReviewSelection = (typeId: number, nation: WorkerNation) => {
  if (EXCLUDED.has(typeId)) return undefined;
  const buildingFunction = BUILDING_FUNCTION[typeId];
  if (!buildingFunction) return undefined;
  const family = ROOF_REVIEW_FUNCTIONS[nation][buildingFunction];
  const vocabulary: RoofVocabulary = ROOF_REVIEW_VOCABULARY[nation];
  return { buildingFunction, family, ...vocabulary[family]! };
};

/** Main roof sheets/shells, excluding loose tiles, pots, finials and any stock display. */
const mainCover = (recipe: BuildingRecipe) => recipe.parts.filter(part => !part.stock && !part.roofLayer &&
  (isRoofCovering(part) || part.shape === "occupation-roof") && part.shape !== "roof-infill" &&
  part.size[0] * part.size[2] > .3).sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2])[0];

const FUNCTION_MASSING: Readonly<Record<string, readonly [number, number, number]>> = {
  woodland: [.24, .28, .07], nursery: [.32, .45, .10], timber: [.32, .62, .12],
  textile: [.40, .42, .16], bakery: [.24, .22, .32], farm: [.25, .35, .10]
};

/** Integrated roof monitors/cowls: a supported ventilation/daylight structure, not freestanding
 * yard scenery. The original shell and all access/inventory contracts remain available beneath it.
 * Native review still decides whether each form deserves a complete roof/body redesign. */
export const applyRoofUpgradeReview = (recipe: BuildingRecipe, typeId: number,
  nation: WorkerNation, detailed: boolean) => {
  const selection = roofReviewSelection(typeId, nation), cover = mainCover(recipe);
  if (!selection || !cover) return { recipe, selection: undefined, supports: [] };
  const { buildingFunction, curve, form, panCover, sweep } = selection;
  const material = cover.surface;
  const support = buildingFunction === "bakery" ? "stone" : selection.support;
  if (nation === "indigenous" && cover.indigenousRoof === "tipi") {
    // A sewn weather hood follows the load-bearing lodge cone. A timber monitor on a full-height
    // textile shell read as an unsupported tower in the first native study and was rejected.
    const height = Math.min(.40, cover.size[1] * .18), fraction = height / cover.size[1];
    const hood: BuildingPart = { architecture: true, indigenousRoof: "tipi", shape: "indigenous-roof",
      position: [cover.position[0], cover.position[1] + cover.size[1] / 2 - height / 2 + .012, cover.position[2]],
      size: [cover.size[0] * fraction + .012, height, cover.size[2] * fraction + .012],
      stage: 4, surface: material };
    return { recipe: { ...recipe, parts: [...recipe.parts, hood] }, selection, supports: [] };
  }
  const bounds = getRomanPartBounds(cover);
  const spans = [bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]];
  const alongX = spans[0]! > spans[1]!;
  const [widthRatio, lengthRatio, height] = FUNCTION_MASSING[buildingFunction]!;
  const width = Math.max(.24, Math.min(.67, Math.min(...spans) * widthRatio));
  const lengthLimit = nation === "indigenous" ? .45 : Infinity;
  const length = Math.min(lengthLimit, Math.max(.3, Math.max(...spans) * lengthRatio));
  // Sloped Roman/Viking box roofs are half a roof: find the ridge at their upper edge.
  const centre: Point3 = [...cover.position];
  if (cover.shape === "box" && cover.rotation) {
    const other = recipe.parts.find(part => part !== cover && part.surface === cover.surface &&
      part.shape === "box" && Math.abs(part.position[1] - cover.position[1]) < .03 &&
      part.size[0] * part.size[2] > cover.size[0] * cover.size[2] * .4 && !part.stock);
    if (other) {
      centre[0] = (cover.position[0] + other.position[0]) / 2;
      centre[2] = (cover.position[2] + other.position[2]) / 2;
    }
  }
  const at = (across: number, along: number, y: number): Point3 => alongX
    ? [centre[0] + along, y, centre[2] + across] : [centre[0] + across, y, centre[2] + along];
  // Include straw and textile shells which the production tile-only roof query intentionally omits.
  const roofParts = recipe.parts.filter(part => !part.roofSupport && !part.stock &&
    (part === cover || isRoofCovering(part)) && part.size[0] * part.size[2] > .15)
    .map(part => part === cover ? { ...part, surface: "roof" as const } : part);
  const sample = (across: number, along: number) => {
    const point = at(across, along, 0);
    return roofTopAt(roofParts, point[0], point[2], detailed) ?? bounds.max[1];
  };
  const ridge = sample(0, 0), eave = ridge + .035;
  const parts: BuildingPart[] = [], supports: Array<{ bottom: Point3; top: Point3 }> = [];
  const add = (surface: BuildingSurface, position: Point3, size: Point3,
    shape: BuildingPart["shape"] = "box", extra: Partial<BuildingPart> = {}) => {
    parts.push({ architecture: true, compactGeometry: true, position, shape, size, stage: 4, surface, ...extra });
  };
  const masonry = buildingFunction === "bakery" || support === "plaster" || support === "stone";
  const wall = masonry ? support : "wood";
  const base = Math.min(sample(-width / 2, -length / 2), sample(width / 2, length / 2)) - .055;
  const wallTop = eave + height;
  for (const side of nation === "indigenous" ? [] : [-1, 1]) {
    // Narrow housings enter the existing roof surface; dark recessed slots remain open above it.
    const slotHeight = height * .38, slotY = eave + height * .56, slotLength = length * .8;
    {
      const segment = (span: number, tall: number, y: number, along: number) => {
        if (tall <= 0) return;
        add(wall, at(side * width * .43, along, y),
          alongX ? [span, tall, .055] : [.055, tall, span]);
      };
      const bottom = slotY - slotHeight / 2, top = slotY + slotHeight / 2;
      segment(length, bottom - base, (bottom + base) / 2, 0);
      segment(length, wallTop - top, (top + wallTop) / 2, 0);
      const end = (length - slotLength) / 2;
      for (const sign of [-1, 1]) segment(end, slotHeight, slotY, sign * (slotLength + end) / 2);
    }
    const slot = at(side * (width * .43 + .029), 0, eave + height * .56);
    {
      const out: Point3 = alongX ? [0, 0, side] : [side, 0, 0];
      addRoofVentWindow({ add: part => parts.push({ architecture: true, compactGeometry: true, ...part, stage: 4 }),
        detailed }, slot, out, slotLength, slotHeight, nation === "roman");
    }
    if (detailed && nation !== "roman") for (let index = 1; index <= 4; index++) {
      const louver = at(side * (width * .43 + .038), length * (index / 5 - .5), eave + height * .56);
      add(wall, louver, [.035, height * .4, .035], "bevel-box");
    }
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const bottom = at(x * width * .43, z * length * .45, sample(x * width * .43, z * length * .45) - .035);
    const top = at(x * width * .43, z * length * .45, wallTop + .025);
    add(support, [(bottom[0] + top[0]) / 2, (bottom[1] + top[1]) / 2, (bottom[2] + top[2]) / 2],
      [.065, top[1] - bottom[1], .065], "box", { roofSupport: true });
    supports.push({ bottom, top });
  }
  const rise = Math.max(.13, width * .43), rotation: Point3 = [0, alongX ? Math.PI / 2 : 0, 0];
  // A low limestone weather cap is the existing Maya flat-stone vocabulary, not a new tile family.
  if (form === "flat") {
    add(material, at(0, 0, wallTop + .04), [width + .12, .08, length + .12], "bevel-box");
  } else {
    const cap: Partial<BuildingPart> = { occupationRoof: form, plantRoofStyle: cover.plantRoofStyle,
      roofCurve: curve, roofSweep: sweep,
      roofTiles: panCover ? "pan-cover" : undefined, rotation };
    let shape: BuildingPart["shape"] = "occupation-roof";
    if (nation === "indigenous" && !masonry) {
      shape = "indigenous-roof";
      cap.indigenousRoof = "awning";
    }
    add(material, at(0, 0, wallTop + rise * .44), [width + .12, rise, length + .12], shape, cap);
    const infill = material === "straw" ? "straw" : support;
    add(infill, at(0, 0, wallTop + rise * .44 - .008), [width * .9, rise, length * .9], "roof-infill",
      { ...cap, roofInfillRatio: [.9, .9] });
  }
  return { recipe: { ...recipe, parts: [...recipe.parts, ...parts] }, selection, supports };
};

/** The base redesign changes the complete roof. Small monitors are reserved for later upgrades. */
export const applyRoofReviewPrototype = (recipe: BuildingRecipe, typeId: number,
  nation: WorkerNation, detailed: boolean, level: BuildingLevel = 1) => {
  const selection = roofReviewSelection(typeId, nation);
  if (!selection) return { recipe, selection: undefined, supports: [] };
  const base = selection.form === "flat" ? { recipe, supports: [] }
    : redesignOccupationRoof(recipe, nation, selection, detailed);
  if (level < 4) return { ...base, selection };
  const upgraded = applyRoofUpgradeReview(base.recipe, typeId, nation, detailed);
  return { ...upgraded, supports: [...base.supports, ...upgraded.supports] };
};
