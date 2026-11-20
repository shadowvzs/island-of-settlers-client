import { hardwoodBirchForm } from "../../shared/world/tree-forms";
import { PROP, type WorldData } from "../../shared/world/world-data";
import {
  getMatureVariant,
  getTreeInstanceScale,
  getTreeSpecies,
  getTreeVariant,
  getTreeVariants,
  ISLAND_TREE_UNITS
} from "../props/island-trees";
import { getBirchArchitecture } from "../trees/birch-shape";
import { getConiferCrown } from "../trees/conifer-model";
import { getHardwoodCrown } from "../trees/hardwood-island-mesh";
import { tierTreeProfile } from "../trees/tier-tree-mesh";
import type { GrowthStage, TreeSpecies } from "../trees/tree-model";
import type { TreeBody } from "./felling-simulation";

/** Height of the axe cut above the ground (prop units, before the instance scale). */
export const PROP_CUT_HEIGHT = 0.16;

interface Crown {
  height: number;
  radius: number;
}

/**
 * Crown centre height and radius (island units) per species, for stage 3 / 4 / 5 meshes;
 * conifers measure theirs from the archetype shape.
 */
const CROWNS: Record<Exclude<TreeSpecies, "pine">, Crown[]> = {
  oak: [
    { height: 1.03, radius: 0.55 },
    { height: 1.43, radius: 0.8 },
    { height: 1.8, radius: 1.05 }
  ],
  palm: [
    { height: 0.9, radius: 0.8 },
    { height: 1.58, radius: 1.1 },
    { height: 2.4, radius: 1.3 }
  ],
  birch: [
    { height: 1.22, radius: 0.38 },
    { height: 1.77, radius: 0.51 },
    { height: 2.23, radius: 0.7 }
  ]
};

/** Untiered crown a tier tree (mahogany, cedar, walnut) scales from. */
const getTierTreeBaseCrown = (kind: number, form: number, stage: GrowthStage): Crown => {
  if (kind === PROP.mahoganyTree) return getHardwoodCrown(form, stage);
  if (kind !== PROP.cedarTree) return CROWNS.oak[stage - 3]!;
  const crown = getConiferCrown(form, stage);
  return { height: crown.height * ISLAND_TREE_UNITS, radius: crown.radius * ISLAND_TREE_UNITS };
};

/** Crown of a tree kind's variant (island units). */
const getCrown = (species: TreeSpecies, kind: number, variant: number): Crown => {
  const { form, stage } = getTreeVariants(kind)[variant]!;
  const birch = kind === PROP.hardwoodTree ? hardwoodBirchForm(form) : undefined;
  if (birch !== undefined) {
    const crown = CROWNS.birch[stage - 3]!, architecture = getBirchArchitecture(birch);
    return { height: crown.height * architecture.height, radius: crown.radius * architecture.crownWidth };
  }
  if ((kind === PROP.cedarTree || kind === PROP.walnutTree || kind === PROP.mahoganyTree)) {
    const profile = tierTreeProfile(kind, form);
    const base = getTierTreeBaseCrown(kind, form, stage);
    return { height: base.height * profile.y, radius: base.radius * profile.x };
  }
  if (kind === PROP.hardwoodTree) return getHardwoodCrown(form, stage);
  if (species !== "pine") return CROWNS[species][stage - 3]!;
  const crown = getConiferCrown(form, stage);
  return { height: crown.height * ISLAND_TREE_UNITS, radius: crown.radius * ISLAND_TREE_UNITS };
};

/**
 * Body of a world prop that can be felled (undefined for rocks, bushes and the like). `mature`:
 * the tree grew to the mature mesh (same instance scale, mature crown).
 */
export const getChoppableTree = (
  world: WorldData,
  id: number,
  mature = false
): TreeBody | undefined => {
  const { props } = world;
  const species = id >= 0 && id < props.count ? getTreeSpecies(props.types[id]!) : undefined;
  if (!species) return undefined;
  const kind = props.types[id]!;
  const variant = getTreeVariant(kind, props.scale[id]!, props.form[id]!);
  const scale = getTreeInstanceScale(kind, props.scale[id]!, variant);
  const shown = mature ? getMatureVariant(kind, variant) : variant;
  const crown = getCrown(species, kind, shown);
  return {
    canopyHeight: crown.height * scale,
    canopyRadius: crown.radius * scale,
    x: props.x[id]!,
    y: props.y[id]!,
    z: props.z[id]!
  };
};

/** Every choppable tree of the world as [id, body] (picking candidates); `mature`: grown bodies. */
export const collectChoppableTrees = (world: WorldData, mature = false) => {
  const trees: [number, TreeBody][] = [];
  for (let id = 0; id < world.props.count; id += 1) {
    const body = getChoppableTree(world, id, mature);
    if (body) trees.push([id, body]);
  }
  return trees;
};
