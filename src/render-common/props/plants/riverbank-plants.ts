import type { Random } from "../../../shared/world/rng";
import { LEAF_SPRAY_RECTS } from "../../trees/foliage-atlas";
import { MeshBuilder, normalize, SEASONAL_LEAF_UV, type Vec3 } from "../mesh-builder";
import { add, fromAngles, scale } from "../tree-parts";
import { addHeadBody } from "./flower-heads";
import { BARK, CARD_TINTS, pickTone, RIVER_GREENS, RIVER_ROOT_SHADE, shaded } from "./plant-colors";
import { shapePlantMesh } from "./plant-mesh-art";
import {
  addBlade,
  addLeaf,
  addStemTube,
  type Attach,
  attachAlong,
  getHeading,
  getTip,
  growStem,
  horizontal,
  type Stem
} from "./plant-parts";
import { addFoliageCards, addShrubWood, growShrubGraph } from "./shrub-graph";

const PLUME: Vec3 = [0.52, 0.42, 0.34];

/** A point near the clump centre: stalks rise from one root zone, never from one pixel. */
const rootPoint = (random: Random, spread: number): Attach => {
  const angle = random() * Math.PI * 2;
  const distance = Math.sqrt(random()) * spread;
  return { path: 0, position: [Math.cos(angle) * distance, -0.01, Math.sin(angle) * distance] };
};

/** Long narrow leaves from the base, arching outwards (cattail, reed and sedge bases). */
const addBaseLeaves = (
  builder: MeshBuilder,
  random: Random,
  count: number,
  size: { length: [number, number]; spread: number; width: number }
) => {
  for (let index = 0; index < count; index += 1) {
    builder.detail = index % 3 === 2;
    const root = rootPoint(random, size.spread);
    const color = pickTone(RIVER_GREENS, random, 0.1);
    addBlade(
      builder,
      root,
      {
        arch: 0.3 + random() * 0.7,
        azimuth: random() * Math.PI * 2,
        lean: 0.08 + random() * 0.35,
        length: size.length[0] + random() * (size.length[1] - size.length[0]),
        segments: 3,
        tipFlutter: 0.6,
        width: size.width
      },
      shaded(color, random, RIVER_ROOT_SHADE)
    );
  }
  builder.detail = false;
};

const addReedLeaves = (builder: MeshBuilder, stalk: Stem, color: Vec3, random: Random) => {
  const leaves = 2 + Math.floor(random() * 3);
  for (let leaf = 0; leaf < leaves; leaf += 1) {
    builder.detail = leaf > 1;
    addBlade(
      builder,
      attachAlong(stalk, 0.18 + leaf * 0.17 + random() * 0.08),
      {
        arch: 0.7 + random() * 0.5,
        azimuth: random() * Math.PI * 2,
        lean: 0.5 + random() * 0.4,
        length: 0.16 + random() * 0.12,
        segments: 2,
        tipFlutter: 1,
        width: 0.024
      },
      shaded(color, random, RIVER_ROOT_SHADE)
    );
  }
  builder.detail = false;
};

/** Reed: dense thin stalk fan, leaves along the stalks, a few bent and dry, some plumes. */
export const createReeds = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const stalks = 10 + variant * 3;
  addBaseLeaves(builder, random, 6, { length: [0.14, 0.24], spread: 0.08, width: 0.026 });
  for (let index = 0; index < stalks; index += 1) {
    const bent = random() < 0.12;
    const root = rootPoint(random, 0.09);
    const stalk = growStem(
      {
        bend: bent ? -0.14 : 0.01,
        direction: fromAngles(random() * Math.PI * 2, Math.PI / 2 - 0.05 - random() * 0.2),
        length: 0.55 + random() * 0.4,
        start: root.position,
        steps: 3,
        wobble: 0.04
      },
      random
    );
    const color = pickTone(RIVER_GREENS, random, 0.14);
    addStemTube(builder, stalk, [0.009, 0.004], 3, shaded(color, random, RIVER_ROOT_SHADE));
    addReedLeaves(builder, stalk, color, random);
    if (random() < 0.4) {
      const axis = normalize(add(getHeading(stalk, 1), [0, -0.5, 0]));
      addHeadBody(
        builder,
        getTip(stalk),
        axis,
        [0.1, 0.018],
        shaded(PLUME, random, RIVER_ROOT_SHADE)
      );
    }
  }
  return builder.finish({ contactRadius: 0.2, flex: 1.05 });
};

/** Sedge / wet grass: a low fountain of arching blades from one dark root zone. */
export const createSedge = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const blades = 24 + variant * 7;
  for (let index = 0; index < blades; index += 1) {
    builder.detail = index % 3 === 2;
    const color = pickTone(RIVER_GREENS, random, 0.08);
    addBlade(
      builder,
      rootPoint(random, 0.05),
      {
        arch: 0.7 + random() * 0.7,
        azimuth: random() * Math.PI * 2,
        lean: 0.12 + random() * 0.55,
        length: 0.2 + random() * 0.18,
        segments: 3,
        tipFlutter: 0.7,
        width: 0.024
      },
      shaded(color, random, { floor: 0.32, reach: 0.12 })
    );
  }
  builder.detail = false;
  return builder.finish({ contactRadius: 0.18, flex: 0.75 });
};

/** River shrub: low, broad and asymmetric; woody stems, many twigs, olive leaf clusters. */
export const createRiverShrub = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const graph = growShrubGraph(
    {
      branchStart: 0.3,
      elevation: [0.6, 1.15],
      foliagePerBranch: [1, 3],
      primaries: [4 + variant, 6 + variant],
      primaryLength: [0.3, 0.44],
      rootSpread: 0.12,
      secondaryBend: 0.03,
      secondaries: [2, 4],
      secondaryLength: [0.13, 0.2],
      stretch: 1.4,
      twigLength: [0.07, 0.1],
      twigs: [1, 2]
    },
    random
  );
  addShrubWood(builder, graph, {
    radius: 0.022,
    style: shaded(BARK.grey, random, RIVER_ROOT_SHADE)
  });
  addFoliageCards(
    builder,
    graph.foliage,
    { cell: LEAF_SPRAY_RECTS[1]!, size: [0.15, 0.22], tint: CARD_TINTS.river },
    random
  );
  return shapePlantMesh(builder.finish({ contactRadius: 0.38, flex: 0.4 }), "shrub", variant);
};

/** Narrow willow leaves hanging along a twig. */
const addHangingLeaves = (builder: MeshBuilder, twig: Stem, count: number, random: Random) => {
  for (let leaf = 0; leaf < count; leaf += 1) {
    builder.detail = leaf % 2 === 1;
    const fraction = 0.25 + (0.75 * (leaf + 0.5)) / count;
    const side = horizontal(random() * Math.PI * 2);
    const direction = normalize(
      add(add(getHeading(twig, fraction), scale(side, 0.8)), [0, -0.5, 0])
    );
    addLeaf(
      builder,
      attachAlong(twig, fraction),
      { direction, droop: 0.015, length: 0.08 + random() * 0.04, width: 0.024 },
      shaded(pickTone(RIVER_GREENS, random, 0.04), random, RIVER_ROOT_SHADE),
      1,
      SEASONAL_LEAF_UV
    );
  }
  builder.detail = false;
};

/** Young willow-like shrub: thin flexible stems branching outwards, drooping leafy tips. */
export const createWillowShrub = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const graph = growShrubGraph(
    {
      branchStart: 0.4,
      elevation: [0.95, 1.3],
      foliagePerBranch: [0, 0],
      primaries: [4 + variant, 6 + variant],
      primaryLength: [0.45, 0.62],
      rootSpread: 0.08,
      secondaryBend: -0.12,
      secondaries: [2, 3],
      secondaryLength: [0.16, 0.24],
      stretch: 1.1,
      twigLength: [0, 0],
      twigs: [0, 0]
    },
    random
  );
  addShrubWood(builder, graph, {
    radius: 0.014,
    style: shaded(BARK.red, random, RIVER_ROOT_SHADE)
  });
  for (const twig of graph.secondaries) addHangingLeaves(builder, twig, 8, random);
  for (const stem of graph.primaries) addHangingLeaves(builder, stem, 6, random);
  return shapePlantMesh(builder.finish({ contactRadius: 0.3, flex: 0.65 }), "shrub", variant);
};
