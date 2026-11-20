import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { roofTopAt } from "./levels/level-roof-surface";
import { type Add, runBetween } from "./nation-kit-parts";

export interface OccupationRoofDesign {
  buildingFunction: string;
  curve?: number;
  form: NonNullable<BuildingPart["occupationRoof"]> | "flat";
  material: BuildingSurface;
  panCover?: boolean;
  support: BuildingSurface;
  sweep?: number;
}

/** Original grounded posts are shortened only where their tips would pierce the new cover. */
const fitIndigenousRoofPosts = (parts: BuildingPart[], roof: BuildingPart, detailed: boolean) => {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const awningPost = part.shape === "cylinder" && Math.abs(part.size[0] - .045) < .00001;
    const sawFramePost = part.shape === "box" && part.workyardAssembly === "equipment-33" &&
      part.size[0] < .08 && part.size[2] < .08 && part.size[1] > .5;
    if (part.stock || part.rotation || part.surface !== "wood" || !awningPost && !sawFramePost) continue;
    const tops: number[] = [];
    for (const x of [-.5, .5]) for (const z of [-.5, .5]) {
      const ceiling = roofTopAt([roof], part.position[0] + x * part.size[0],
        part.position[2] + z * part.size[2], detailed);
      if (ceiling !== null) tops.push(ceiling);
    }
    if (!tops.length) continue;
    const ceiling = Math.min(...tops);
    if (part.position[1] + part.size[1] / 2 <= ceiling - .018) continue;
    // Keep the original grounded bearing; only its obsolete exposed head is cut to the new cover.
    const base = part.position[1] - part.size[1] / 2, height = ceiling - .025 - base;
    if (height <= 0) continue;
    parts[index] = { ...part, position: [part.position[0], base + height / 2, part.position[2]],
      size: [part.size[0], height, part.size[2]] };
  }
};

const weatherSkin = (part: BuildingPart) => !part.stock && !part.roofLayer &&
  (part.shape === "occupation-roof" || part.shape === "nation-roof" ||
    ["dome", "ogive-dome", "persian-dome", "persian-barrel"].includes(part.shape) && part.surface === "roof" ||
    part.shape === "indigenous-roof" || part.shape === "civic-hipped-roof" ||
    part.surface.startsWith("roof") && part.size[1] < .18 ||
    part.surface === "straw" && part.shape === "box" && part.rotation) &&
  part.size[0] * part.size[2] > .3;

/** Replaces the complete main roof, including old sheets/infill, with one supported national roof.
 * Side workshop covers stay in their own equipment groups and are composed by the workyard owner. */
export const redesignOccupationRoof = (recipe: BuildingRecipe, nation: WorkerNation,
  design: OccupationRoofDesign, detailed: boolean) => {
  const covers = recipe.parts.filter(weatherSkin);
  const largest = covers.slice().sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2])[0];
  if (!largest) return { recipe, supports: [] };
  // Full-height textile lodges retain their load-bearing enclosure; the attached work shelter is
  // redesigned separately. A new cap would repeat the rejected miniature-roof approach.
  if (largest.indigenousRoof === "tipi" || largest.indigenousEntrance) return { recipe, supports: [] };
  const reference = getRomanPartBounds(largest);
  const selected = covers.filter(part => {
    const bound = getRomanPartBounds(part);
    return bound.min[0] <= reference.max[0] + .04 && bound.max[0] >= reference.min[0] - .04 &&
      bound.min[2] <= reference.max[2] + .04 && bound.max[2] >= reference.min[2] - .04 &&
      Math.abs(part.position[1] - largest.position[1]) < .35;
  });
  const bounds = selected.map(part => getRomanPartBounds(part));
  const min: Point3 = [0, 1, 2].map(axis => Math.min(...bounds.map(b => b.min[axis]!))) as Point3;
  const max: Point3 = [0, 1, 2].map(axis => Math.max(...bounds.map(b => b.max[axis]!))) as Point3;
  const roofSet = new Set(selected);
  const inside = (part: BuildingPart) => part.position[0] >= min[0] - .06 &&
    part.position[0] <= max[0] + .06 && part.position[2] >= min[2] - .06 &&
    part.position[2] <= max[2] + .06;
  const parts = recipe.parts.filter(part => {
    if (part.stock) return true;
    if (roofSet.has(part)) return false;
    const roofMember = part.surface.startsWith("roof") || part.roofLayer || part.roofSupport ||
      part.shape === "persian-room" && part.occupationRoof === "barrel" ||
      ["tile", "gable", "roof-infill"].includes(part.shape);
    return !(roofMember && inside(part) && getRomanPartBounds(part).max[1] >= min[1] - .05);
  });
  const width = max[0] - min[0], depth = max[2] - min[2];
  const turned = width > depth * 1.1;
  const across = turned ? depth : width, along = turned ? width : depth;
  const pitch = { woodland: .42, nursery: .49, timber: .34, textile: .58, bakery: .38 }[design.buildingFunction] ?? .45;
  const rise = Math.max(.3, across * pitch), eave = min[1] + .035;
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const point = (u: number, v: number, y: number): Point3 => turned
    ? [cx + v * along, y, cz - u * across] : [cx + u * across, y, cz + v * along];
  const shape: BuildingPart["shape"] = "occupation-roof";
  const form = design.form === "flat" ? "hip" : design.form;
  const roof: BuildingPart = { architecture: true, occupationRoof: form,
    position: [cx, eave + rise * .48, cz], rotation: turned ? [0, Math.PI / 2, 0] : undefined,
    roofCurve: design.curve, roofSweep: design.sweep, roofTiles: design.panCover ? "pan-cover" : undefined,
    shape, size: [across, rise, along], stage: 3, surface: design.material };
  if (nation === "viking" && design.material === "roof") {
    roof.shape = "nation-roof"; roof.roofProfile = "viking";
  }
  if (nation === "indigenous") {
    roof.shape = "indigenous-roof"; roof.indigenousRoof = "awning";
  }
  const add: Add = part => parts.push({ architecture: true, compactGeometry: true, stage: 3, ...part });
  add({ ...roof, compactGeometry: false });
  const plantRoofStyle = ["straw", "roof-thatch", "palm-thatch"].includes(design.material) ? "reed" : undefined;
  add({ ...roof, shape: "roof-infill", plantRoofStyle, roofInfillRatio: [.90, .90],
    size: [across * .90, rise, along * .90], position: [cx, roof.position[1] - .001, cz],
    stage: 2, surface: design.support });
  const top = (u: number, v: number) => {
    const p = point(u, v, 0);
    return roofTopAt([roof], p[0], p[2], detailed) ?? eave;
  };
  if (nation === "indigenous") fitIndigenousRoofPosts(parts, roof, detailed);
  const supports: Array<{ bottom: Point3; top: Point3 }> = [];
  const tieHeight = nation === "indigenous" ? eave - .055 : eave;
  for (const side of [-1, 1]) {
    const a = point(side * .45, -.47, tieHeight), b = point(side * .45, .47, tieHeight);
    runBetween(add, a, b, [.07, .09], { stage: 2, surface: design.support, roofSupport: true });
  }
  const count = detailed ? Math.max(4, Math.ceil(along / .28)) : 4;
  for (let index = 0; index <= count; index++) {
    const v = -.46 + index / count * .92;
    for (const side of [-1, 1]) {
      const bottom = point(side * .445, v, top(side * .445, v) - .065);
      const peak = point(0, v, top(0, v) - .065);
      runBetween(add, bottom, peak, [.035, .045],
        { stage: 2, surface: design.support, roofSupport: true });
      supports.push({ bottom, top: peak });
    }
  }
  return { recipe: { ...recipe, parts }, supports };
};
