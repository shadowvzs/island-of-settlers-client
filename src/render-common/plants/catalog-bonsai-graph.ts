import type { Point3 } from "../buildings/building-recipe";
import { catalogBonsaiArchitecture } from "./catalog-bonsai-architecture";
import {
  addOrnamentalLimb, ornamentalNoise, ornamentalPointBetween,
  type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

export type CatalogBonsaiSpecies = "bonsai-pine" | "bonsai-juniper" | "bonsai-azalea" | "bonsai-maple";
export interface CatalogBonsaiPad { centre: Point3; radius: number; branch: number }
export interface CatalogBonsaiGraph { wood: OrnamentalTreeGraph; pads: CatalogBonsaiPad[] }

/** Upright, left leaning and twin trunk trained trees, with bilateral counterbranches. */
export const createCatalogBonsaiGraph = (species: CatalogBonsaiSpecies, variant: number,
  potted: boolean): CatalogBonsaiGraph => {
  const pot = { style: "oval" as const, width: .50, depth: .34, height: .12 };
  const base = potted ? pot.height - .022 : .006;
  const wood: OrnamentalTreeGraph = { species: "bonsai-pine", variant,
    limbs: [], needles: [], leaves: [], blossoms: [], pot: potted ? pot : undefined };
  const architecture = catalogBonsaiArchitecture(species, variant, base);
  const path = architecture.path;
  const trunk = addOrnamentalLimb(wood, null, path, architecture.thickness, .005, "trunk");
  for (let root = 0; root < 7; root++) {
    const angle = root * 2.399963 + variant * .6, reach = .09 + ornamentalNoise(root + 51) * .07;
    const start = path[0]!;
    addOrnamentalLimb(wood, trunk, [start,
      [start[0] + Math.cos(angle) * reach * .48, base + .009, Math.sin(angle) * reach * .4],
      [start[0] + Math.cos(angle) * reach, base - .015, Math.sin(angle) * reach * .75]],
    .024 + ornamentalNoise(root) * .01, .002, "root");
  }
  if (variant === 2) addOrnamentalLimb(wood, trunk,
    [path[1]!, [.075, base + .17, .035], [.105, base + .29, -.015], [.13, base + .39, 0]],
    architecture.thickness * .57, .004, "branch");
  const pads = architecture.pads.map((pad, index) => {
    let parent = trunk, parentPath = path;
    if (variant === 2 && index % 2 === 1) { parent = 8; parentPath = wood.limbs[parent]!.path; }
    const attachment = Math.min(parentPath.length - 2, Math.floor(index * .55) + 1);
    const attach = parentPath[attachment]!;
    const middle = ornamentalPointBetween(attach, pad.centre, .55);
    middle[1] -= species === "bonsai-juniper" ? .045 : .018;
    const radius = Math.max(.009, architecture.thickness * .38 - index * .0013);
    const branch = addOrnamentalLimb(wood, parent, [attach, middle, pad.centre], radius, .0035, "branch");
    return { ...pad, branch };
  });
  return { wood, pads };
};

/** Conservative union of every quality/tier. Raised foliage never becomes a ground bearing. */
export const catalogBonsaiClearance = (asset: {
  species: string; variant: number; potted: boolean;
}): readonly { min: Point3; max: Point3 }[] => {
  const heights: Record<string, number> = {
    "bonsai-pine": .83, "bonsai-juniper": .70, "bonsai-azalea": .67, "bonsai-maple": .77
  };
  const height = heights[asset.species];
  if (!height || (asset.species === "bonsai-maple" && asset.potted)) return [];
  const { wood } = createCatalogBonsaiGraph(asset.species as CatalogBonsaiSpecies, asset.variant, asset.potted);
  const boxes: { min: Point3; max: Point3 }[] = [];
  const lowScale = height / (asset.potted ? .75 : .65);
  const highScale = height / (asset.potted ? .42 : .32);
  for (const limb of wood.limbs) {
    for (let segment = 0; segment < limb.path.length - 1; segment++) {
      const from = limb.path[segment]!, to = limb.path[segment + 1]!;
      const radius = limb.radius * (1 - segment / (limb.path.length - 1)) + .014;
      const minY = Math.min(from[1], to[1]) - radius;
      boxes.push({
        min: [(Math.min(from[0], to[0]) - radius) * .8,
          Math.min(minY * lowScale, minY * highScale), (Math.min(from[2], to[2]) - radius) * .8],
        max: [(Math.max(from[0], to[0]) + radius) * .8,
          Math.min(height, (Math.max(from[1], to[1]) + radius) * highScale),
          (Math.max(from[2], to[2]) + radius) * .8]
      });
    }
  }
  boxes.push({ min: [-.36, height * .16, -.23], max: [.36, height, .23] });
  if (asset.potted) boxes.push({ min: [-.225, 0, -.153], max: [.225, .12 * highScale, .153] });
  return boxes;
};
