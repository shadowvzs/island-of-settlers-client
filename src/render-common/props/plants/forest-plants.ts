import type { Random } from "../../../shared/world/rng";
import { BIRCH, BROADLEAF } from "../../../shared/world/tree-forms";
import { PROP } from "../../../shared/world/world-data";
import { LEAF_SPRAY_RECTS } from "../../trees/foliage-atlas";
import { SAPLING_STAGE } from "../../trees/tree-model";
import { createIslandTreeStageMesh } from "../island-trees";
import { MeshBuilder, normalize, SEASONAL_LEAF_UV, type Vec3 } from "../mesh-builder";
import { treeModelSeed } from "../prop-mesh-seed";
import { add, fromAngles, scale } from "../tree-parts";
import { BARK, CARD_TINTS, FOREST_GREENS, pickTone, shaded } from "./plant-colors";
import { shapePlantMesh } from "./plant-mesh-art";
import {
  addLeaf,
  addSpindle,
  addStemTube,
  type Attach,
  attachAlong,
  getAxisFrame,
  getHeading,
  getTip,
  growStem,
  horizontal,
  roundProfile,
  type Stem
} from "./plant-parts";
import { addFoliageCards, addShrubWood, growShrubGraph, type ShrubGraph } from "./shrub-graph";

const BASE_SHADE = { floor: 0.36, reach: 0.18 };
const BERRY_COLORS: Vec3[] = [
  [0.62, 0.08, 0.1],
  [0.7, 0.14, 0.12],
  [0.16, 0.12, 0.3]
];

/** A few brown dead leaves inside the crown (restrained: the plant must look healthy). */
const addDeadLeaves = (builder: MeshBuilder, graph: ShrubGraph, count: number, random: Random) => {
  for (let index = 0; index < count; index += 1) {
    const point = graph.foliage[Math.floor(random() * graph.foliage.length)]!;
    addLeaf(
      builder,
      point,
      { direction: horizontal(random() * Math.PI * 2), droop: 0.02, length: 0.07, width: 0.04 },
      shaded(pickTone(FOREST_GREENS, random, 1), random, BASE_SHADE)
    );
  }
};

/**
 * Woody forest shrub (hornbeam-hazel): several woody stems from the root crown, bare low down,
 * forking into branches and leafy twigs; overlapping sprays build a dense, rounded crown.
 */
export const createWoodyShrub = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const graph = growShrubGraph(
    {
      branchStart: 0.3,
      elevation: [0.75, 1.3],
      foliagePerBranch: [1, 1],
      primaries: [6, 7 + variant],
      primaryLength: [0.32, 0.44],
      rootSpread: 0.1,
      secondaryBend: 0.05,
      secondaries: [2, 3],
      secondaryLength: [0.14, 0.2],
      stretch: 1.25,
      twigLength: [0.07, 0.11],
      twigs: [2, 2]
    },
    random
  );
  addShrubWood(builder, graph, { radius: 0.018, style: shaded(BARK.woody, random, BASE_SHADE) });
  addFoliageCards(
    builder,
    graph.foliage,
    { cell: LEAF_SPRAY_RECTS[2]!, size: [0.2, 0.28], tint: CARD_TINTS.forest },
    random
  );
  addDeadLeaves(builder, graph, 3, random);
  return shapePlantMesh(builder.finish({ contactRadius: 0.36, flex: 0.35 }), "shrub", variant);
};

/** Two to four berries on short stalks at a twig end (never loose in the air). */
const addBerryCluster = (builder: MeshBuilder, tip: Attach, color: Vec3, random: Random) => {
  const berries = 2 + Math.floor(random() * 2);
  for (let index = 0; index < berries; index += 1) {
    const direction = normalize(add(horizontal(random() * Math.PI * 2), [0, -0.6, 0]));
    const stalk = growStem(
      { bend: 0, direction, length: 0.03, start: tip.position, steps: 1, wobble: 0 },
      random,
      tip.path
    );
    addStemTube(builder, stalk, [0.003, 0.002], 3, shaded(BARK.red, random));
    addSpindle(
      builder,
      getTip(stalk),
      { axis: direction, length: 0.03, profile: roundProfile(0.017), rings: 2, sides: 4 },
      shaded(color, random, BASE_SHADE, 0.2)
    );
  }
};

/** Berry bush: thin branchy uneven dome, leaf clusters, sparse berries on the twig ends. */
export const createBerryBush = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const graph = growShrubGraph(
    {
      branchStart: 0.25,
      elevation: [0.7, 1.2],
      foliagePerBranch: [1, 1],
      primaries: [5, 7],
      primaryLength: [0.28, 0.38],
      rootSpread: 0.1,
      secondaryBend: 0.02,
      secondaries: [2, 3],
      secondaryLength: [0.12, 0.18],
      stretch: 1.15,
      twigLength: [0.06, 0.09],
      twigs: [1, 2]
    },
    random
  );
  addShrubWood(builder, graph, { radius: 0.017, style: shaded(BARK.red, random, BASE_SHADE) });
  addFoliageCards(
    builder,
    graph.foliage,
    { cell: LEAF_SPRAY_RECTS[3]!, size: [0.15, 0.21], tint: CARD_TINTS.forest },
    random
  );
  const color = BERRY_COLORS[variant % BERRY_COLORS.length]!;
  graph.tips.forEach((tip, index) => {
    if (index % 3 === 0) addBerryCluster(builder, tip, color, random);
  });
  return shapePlantMesh(builder.finish({ contactRadius: 0.32, flex: 0.4 }), "shrub", variant);
};

/** Pairs of leaflets along a frond, longest in the middle, shortest at the tip. */
const addPinnae = (builder: MeshBuilder, rachis: Stem, random: Random) => {
  const pairs = 10;
  for (let pair = 0; pair < pairs; pair += 1) {
    builder.detail = pair % 2 === 1;
    const t = 0.14 + (0.84 * pair) / pairs;
    const heading = getHeading(rachis, t);
    const { first } = getAxisFrame(heading);
    const side = normalize([first[0], 0, first[2]]);
    const length = 0.085 * Math.sin(Math.PI * (0.15 + t * 0.8)) + 0.012;
    const color = pickTone(FOREST_GREENS, random, 0.03);
    for (const sign of [-1, 1]) {
      const direction = normalize(add(add(scale(side, sign), scale(heading, 0.55)), [0, 0.05, 0]));
      addLeaf(
        builder,
        attachAlong(rachis, t),
        { direction, droop: 0.008, length, width: length * 0.32 },
        shaded(scale(color, 1.12), random, BASE_SHADE)
      );
    }
  }
  builder.detail = false;
};

/** Fern: fronds from one root crown, curved rachis, leaflets in a radial arching fan. */
export const createFern = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const fronds = 6 + variant;
  const turn = random() * Math.PI * 2;
  for (let index = 0; index < fronds; index += 1) {
    const azimuth = turn + (index / fronds) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const rachis = growStem(
      {
        bend: -0.09,
        direction: fromAngles(azimuth, 0.95 + random() * 0.35),
        length: 0.32 + random() * 0.14,
        start: [(random() - 0.5) * 0.03, -0.01, (random() - 0.5) * 0.03],
        steps: 5,
        wobble: 0.04
      },
      random
    );
    addStemTube(builder, rachis, [0.006, 0.002], 3, shaded([0.24, 0.3, 0.12], random, BASE_SHADE));
    addPinnae(builder, rachis, random);
  }
  return builder.finish({ contactRadius: 0.26, flex: 0.45 });
};

/** Decoration saplings: young trees of the island's own species and forms (variant order). */
const SAPLING_TREES: readonly (readonly [number, number])[] = [
  [PROP.birchTree, BIRCH.young],
  [PROP.broadleafTree, BROADLEAF.oak],
  [PROP.birchTree, BIRCH.classic]
];
/**
 * Sapling (about one cell tall): the last sapling growth stage model of a birch or oak (tapering
 * bark trunk, connected limbs, the species' leaf sprays and wind), so a meadow sapling reads as the
 * tree it grows into.
 */
export const createSapling = (random: Random, variant: number) => {
  const [kind, form] = SAPLING_TREES[variant % SAPLING_TREES.length]!;
  return createIslandTreeStageMesh(kind, SAPLING_STAGE, form, treeModelSeed(random));
};

/** Low broadleaf shrub: short stems, layered overlapping broad leaves, dark centre, wide. */
export const createBroadleafShrub = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const stems = 6 + variant;
  for (let index = 0; index < stems; index += 1) {
    const stem = growStem(
      {
        bend: 0.04,
        direction: fromAngles((index / stems) * Math.PI * 2 + random() * 0.6, 0.5 + random() * 0.5),
        length: 0.13 + random() * 0.08,
        start: [(random() - 0.5) * 0.05, -0.01, (random() - 0.5) * 0.05],
        steps: 2,
        wobble: 0.1
      },
      random
    );
    addStemTube(builder, stem, [0.01, 0.005], 3, shaded([0.22, 0.26, 0.12], random, BASE_SHADE));
    const leaves = 3 + Math.floor(random() * 2);
    for (let leaf = 0; leaf < leaves; leaf += 1) {
      builder.detail = leaf === leaves - 1;
      const t = 0.45 + (0.55 * leaf) / Math.max(1, leaves - 1);
      const out = normalize(
        add(getHeading(stem, t), add(horizontal(random() * Math.PI * 2), [0, 0.25, 0]))
      );
      const length = 0.11 + random() * 0.05;
      addLeaf(
        builder,
        attachAlong(stem, t),
        { direction: out, droop: 0.025, length, width: length * 0.62 },
        shaded(pickTone(FOREST_GREENS, random, 0.04), random, { floor: 0.5, reach: 0.07 }),
        1,
        SEASONAL_LEAF_UV
      );
    }
  }
  builder.detail = false;
  return shapePlantMesh(builder.finish({ contactRadius: 0.3, flex: 0.3 }), "shrub", variant);
};
