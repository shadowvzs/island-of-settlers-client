import type { Random } from "../../../shared/world/rng";
import { randomInRange } from "../../../shared/world/rng";
import { rgb } from "../../color";
import { LEAF_SPRAY_RECTS } from "../../trees/foliage-atlas";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { add, fromAngles } from "../tree-parts";
import { addRosette } from "./field-flowers";
import { addHeadBody } from "./flower-heads";
import { BARK, CARD_TINTS, FIELD_GREENS, pickTone, shaded } from "./plant-colors";
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
  horizontal} from "./plant-parts";
import { addFoliageCards, addShrubWood, growShrubGraph } from "./shrub-graph";

const ROOT: Attach = { path: 0, position: [0, -0.01, 0] };
const GRASS_SHADE = { floor: 0.5, reach: 0.1 };
const SEED: Vec3 = [0.66, 0.6, 0.4];

interface TuftOptions {
  arch: [number, number];
  blades: number;
  /** Blades after this many go to the detailed LOD only. */
  core: number;
  dryChance: number;
  length: [number, number];
  segments: number;
  spread: number;
  width: number;
}

/** Blades from one compact root area, varied length, slight outward fan. */
const addTuft = (builder: MeshBuilder, options: TuftOptions, random: Random) => {
  for (let index = 0; index < options.blades; index += 1) {
    builder.detail = index >= options.core;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * options.spread;
    const root: Attach = {
      path: 0,
      position: [Math.cos(angle) * distance, -0.01, Math.sin(angle) * distance]
    };
    addBlade(
      builder,
      root,
      {
        arch: randomInRange(random, options.arch),
        azimuth: angle + (random() - 0.5) * 1.2,
        lean: 0.1 + random() * 0.35,
        length: randomInRange(random, options.length),
        segments: options.segments,
        tipFlutter: 0.5,
        width: options.width
      },
      shaded(pickTone(FIELD_GREENS, random, options.dryChance), random, GRASS_SHADE)
    );
  }
  builder.detail = false;
};

/** Short grass: the cheap filler, 8-15 blades (neutral greens; the ground tints each tuft). */
export const createShortGrass = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const blades = 9 + variant * 3;
  addTuft(
    builder,
    {
      arch: [0.1, 0.5],
      blades,
      core: 7,
      dryChance: 0.08,
      length: [0.14, 0.27],
      segments: 1,
      spread: 0.14,
      width: 0.04
    },
    random
  );
  return shapePlantMesh(builder.finish({ flex: 0.8 }), "grass", variant);
};

/** Seed stalk: a thin straight stem with a narrow seed head on top. */
const addSeedStem = (builder: MeshBuilder, height: number, random: Random) => {
  const stalk = growStem(
    {
      bend: 0.01,
      direction: fromAngles(random() * Math.PI * 2, 1.32 + random() * 0.2),
      length: height,
      start: [(random() - 0.5) * 0.06, -0.01, (random() - 0.5) * 0.06],
      steps: 2,
      wobble: 0.04
    },
    random
  );
  addStemTube(builder, stalk, [0.004, 0.0025], 3, shaded(SEED, random, GRASS_SHADE));
  const head = attachAlong(stalk, 0.82);
  addHeadBody(builder, head, getHeading(stalk, 0.9), [height * 0.2, 0.011], shaded(SEED, random));
};

/** Tall grass: fewer long blades bending strongly at the tips, one to three seed stalks. */
export const createTallGrass = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  addTuft(
    builder,
    {
      arch: [0.6, 1.2],
      blades: 5 + variant * 2,
      core: 5,
      dryChance: 0.1,
      length: [0.28, 0.42],
      segments: 3,
      spread: 0.08,
      width: 0.035
    },
    random
  );
  for (let index = 0; index <= variant; index += 1)
    addSeedStem(builder, 0.36 + random() * 0.1, random);
  return shapePlantMesh(builder.finish({ flex: 1.1 }), "grass", variant);
};

/** Dry tuft: tan and olive blades, sparse, bent over, compact base. */
export const createDryTuft = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  addTuft(
    builder,
    {
      arch: [0.5, 1.1],
      blades: 7 + variant * 2,
      core: 6,
      dryChance: 0.8,
      length: [0.12, 0.24],
      segments: 2,
      spread: 0.1,
      width: 0.032
    },
    random
  );
  return shapePlantMesh(builder.finish({ flex: 0.8 }), "grass", variant);
};

/** Seed head grass: upright stems with narrow heads above a few short blades. */
export const createSeedGrass = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  addTuft(
    builder,
    {
      arch: [0.3, 0.7],
      blades: 5,
      core: 4,
      dryChance: 0.15,
      length: [0.1, 0.18],
      segments: 2,
      spread: 0.08,
      width: 0.032
    },
    random
  );
  for (let index = 0; index < 2 + variant; index += 1)
    addSeedStem(builder, 0.26 + random() * 0.12, random);
  return shapePlantMesh(builder.finish({ flex: 0.9 }), "grass", variant);
};

/** Trefoil: three round leaflets on a tiny stalk tip, facing up. */
const addTrefoil = (builder: MeshBuilder, tip: Attach, random: Random) => {
  const color = pickTone(FIELD_GREENS, random, 0.02);
  const turn = random() * Math.PI * 2;
  for (let leaf = 0; leaf < 3; leaf += 1) {
    addLeaf(
      builder,
      tip,
      {
        direction: add(horizontal(turn + leaf * 2.094), [0, 0.15, 0]),
        droop: 0.004,
        length: 0.05,
        width: 0.046
      },
      shaded([color[0] * 0.8, color[1] * 0.95, color[2] * 0.85], random, GRASS_SHADE),
      0.3
    );
  }
};

/** Clover: a very low leafy patch of trefoils, sometimes a pink or purple head. */
export const createClover = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  for (let index = 0; index < 7; index += 1) {
    builder.detail = index >= 5;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 0.15;
    const tip: Attach = {
      path: 0.03,
      position: [Math.cos(angle) * distance, 0.02 + random() * 0.035, Math.sin(angle) * distance]
    };
    addTrefoil(builder, tip, random);
  }
  builder.detail = false;
  for (let head = 0; head < variant; head += 1) {
    const stalk = growStem(
      {
        bend: 0.02,
        direction: fromAngles(random() * Math.PI * 2, 1.3),
        length: 0.08 + random() * 0.03,
        start: [(random() - 0.5) * 0.1, -0.01, (random() - 0.5) * 0.1],
        steps: 2,
        wobble: 0.04
      },
      random
    );
    addStemTube(builder, stalk, [0.003, 0.002], 3, shaded([0.3, 0.42, 0.16], random));
    const color = head % 2 === 0 ? rgb(0xc86a9c) : rgb(0x9c6ac8);
    addHeadBody(builder, getTip(stalk), [0, 1, 0], [0.032, 0.02], shaded(color, random));
  }
  return builder.finish({ flex: 0.25 });
};

/** Field weed: a short central stem with a few broad leaves around it, irregular. */
export const createFieldWeed = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  addRosette(builder, ROOT, 4 + variant, 0.1, random);
  const stem = growStem(
    {
      bend: 0.03,
      direction: fromAngles(random() * Math.PI * 2, 1.35),
      length: 0.1 + variant * 0.03,
      start: ROOT.position,
      steps: 2,
      wobble: 0.08
    },
    random
  );
  addStemTube(builder, stem, [0.006, 0.003], 3, shaded([0.3, 0.42, 0.16], random, GRASS_SHADE));
  for (let leaf = 0; leaf < 2 + variant; leaf += 1) {
    const direction = normalize(add(horizontal(leaf * 2.3 + random()), [0, 0.6, 0]));
    addLeaf(
      builder,
      attachAlong(stem, 0.45 + leaf * 0.2),
      { direction, droop: 0.012, length: 0.07, width: 0.045 },
      shaded(pickTone(FIELD_GREENS, random), random, GRASS_SHADE)
    );
  }
  return builder.finish({ flex: 0.35 });
};

/** Low field shrub: two to five short stems, small foliage clusters, wider than tall. */
export const createFieldShrub = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const graph = growShrubGraph(
    {
      branchStart: 0.35,
      elevation: [0.45, 0.85],
      foliagePerBranch: [1, 2],
      primaries: [2 + variant, 3 + variant],
      primaryLength: [0.2, 0.28],
      rootSpread: 0.06,
      secondaryBend: 0.04,
      secondaries: [1, 2],
      secondaryLength: [0.1, 0.14],
      stretch: 1.3,
      twigLength: [0.05, 0.08],
      twigs: [1, 1]
    },
    random
  );
  addShrubWood(builder, graph, { radius: 0.016, style: shaded(BARK.woody, random) });
  addFoliageCards(
    builder,
    graph.foliage,
    { cell: LEAF_SPRAY_RECTS[1]!, size: [0.11, 0.15], tint: CARD_TINTS.field },
    random
  );
  return shapePlantMesh(builder.finish({ contactRadius: 0.26, flex: 0.3 }), "shrub", variant);
};
