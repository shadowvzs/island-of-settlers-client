import type { Random } from "../../../shared/world/rng";
import { rgb } from "../../color";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { add, fromAngles } from "../tree-parts";
import { addHeadBody, addPetalHead, type PetalHeadOptions } from "./flower-heads";
import { FIELD_GREENS, pickTone, shaded } from "./plant-colors";
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

export type FlowerColor = "pink" | "white" | "yellow";

interface FlowerLook {
  centre: Vec3;
  head: Omit<PetalHeadOptions, "facing">;
  petals: Vec3[];
}

/** Small heads (accents, never decorative giants): buttercup cups, daisies, campion / poppy. */
const FLOWER_LOOKS: Record<FlowerColor, FlowerLook> = {
  pink: {
    centre: rgb(0x5a2030),
    head: { cup: 0.45, petals: 5, radius: 0.045 },
    petals: [rgb(0xd8507a), rgb(0xc8323a), rgb(0xb878c8)]
  },
  white: {
    centre: rgb(0xe8b828),
    head: { cup: 0.12, petals: 9, radius: 0.05 },
    petals: [rgb(0xf2efe6), rgb(0xf6f3ee)]
  },
  yellow: {
    centre: rgb(0xd09a18),
    head: { cup: 0.55, petals: 5, radius: 0.045 },
    petals: [rgb(0xf0c828), rgb(0xf4d63a)]
  }
};

const STALK_SHADE = { floor: 0.45, reach: 0.12 };

/** Low leaves around the stalk base (rosette): the plant has a visible root. */
export const addRosette = (
  builder: MeshBuilder,
  root: Attach,
  count: number,
  size: number,
  random: Random
) => {
  const turn = random() * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const direction = add(horizontal(turn + (index / count) * Math.PI * 2), [0, 0.35, 0]);
    const length = size * (0.75 + random() * 0.4);
    addLeaf(
      builder,
      root,
      { direction, droop: length * 0.25, length, width: length * 0.45 },
      shaded(pickTone(FIELD_GREENS, random, 0.05), random, STALK_SHADE)
    );
  }
};

/** Thin flexible stalk with one or two small leaves and the head on its tip. */
const addFlowerStalk = (
  builder: MeshBuilder,
  root: Attach,
  color: FlowerColor,
  height: number,
  random: Random
) => {
  const stalk = growStem(
    {
      bend: 0.02,
      direction: fromAngles(random() * Math.PI * 2, 1.3 + random() * 0.22),
      length: height,
      start: root.position,
      steps: 3,
      wobble: 0.05
    },
    random,
    root.path
  );
  addStemTube(builder, stalk, [0.005, 0.003], 3, shaded([0.3, 0.46, 0.16], random, STALK_SHADE));
  const leaf = attachAlong(stalk, 0.3 + random() * 0.25);
  const out = add(horizontal(random() * Math.PI * 2), [0, 0.5, 0]);
  addLeaf(
    builder,
    leaf,
    { direction: out, droop: 0.008, length: 0.05, width: 0.018 },
    shaded(pickTone(FIELD_GREENS, random), random, STALK_SHADE),
    0.5
  );
  const look = FLOWER_LOOKS[color];
  const petals = look.petals[Math.floor(random() * look.petals.length)]!;
  const facing = normalize(add(getHeading(stalk, 1), [0, 1.2, 0]));
  addPetalHead(
    builder,
    getTip(stalk),
    { ...look.head, facing, radius: look.head.radius * (0.85 + random() * 0.3) },
    shaded(petals, random, STALK_SHADE, 0.06),
    shaded(look.centre, random, STALK_SHADE)
  );
};

/** Wildflower: one to three thin stalks from one root, a few leaves, small heads on top. */
export const createWildflower = (color: FlowerColor) => (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const root: Attach = { path: 0, position: [0, -0.01, 0] };
  addRosette(builder, root, 3 + (variant % 2), 0.06, random);
  const stalks = color === "pink" ? 1 + (variant % 2) : 1 + variant;
  for (let index = 0; index < stalks; index += 1) {
    addFlowerStalk(builder, root, color, 0.2 + random() * 0.12, random);
  }
  return builder.finish({ flex: 0.7 });
};

const CLUMP_COLORS: FlowerColor[] = ["yellow", "white", "pink"];

/** Flower clump (world prop): a few flowers of one kind among grass blades, in meadow patches. */
export const createFlowerClump = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const color = CLUMP_COLORS[variant % CLUMP_COLORS.length]!;
  for (let index = 0; index < 4; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 0.04 + random() * 0.16;
    const root: Attach = {
      path: 0,
      position: [Math.cos(angle) * distance, -0.01, Math.sin(angle) * distance]
    };
    addRosette(builder, root, 3, 0.05, random);
    addFlowerStalk(builder, root, color, 0.17 + random() * 0.1, random);
  }
  for (let blade = 0; blade < 10; blade += 1) {
    const angle = random() * Math.PI * 2;
    addBlade(
      builder,
      { path: 0, position: [Math.cos(angle) * 0.12, -0.01, Math.sin(angle) * 0.12] },
      {
        arch: 0.5,
        azimuth: angle,
        lean: 0.2 + random() * 0.3,
        length: 0.12 + random() * 0.08,
        segments: 2,
        tipFlutter: 0.5,
        width: 0.03
      },
      shaded(pickTone(FIELD_GREENS, random, 0.08), random, STALK_SHADE)
    );
  }
  return builder.finish({ contactRadius: 0.16, flex: 0.7 });
};

/** Thistle accent: thick stalk, narrow spiny leaves, a few branches with purple heads. */
export const createThistle = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const stalk = growStem(
    {
      bend: 0.01,
      direction: fromAngles(random() * Math.PI * 2, 1.45),
      length: 0.3 + random() * 0.1,
      start: [0, -0.01, 0],
      steps: 4,
      wobble: 0.04
    },
    random
  );
  const green: Vec3 = [0.32, 0.42, 0.24];
  addStemTube(builder, stalk, [0.01, 0.005], 4, shaded(green, random, STALK_SHADE));
  for (let leaf = 0; leaf < 6; leaf += 1) {
    const t = 0.08 + leaf * 0.11;
    const direction = add(horizontal(leaf * 2.4 + random()), [0, 0.15, 0]);
    addLeaf(
      builder,
      attachAlong(stalk, t),
      { direction, droop: 0.02, length: 0.1 - t * 0.08, width: 0.032 },
      shaded(green, random, STALK_SHADE)
    );
  }
  const heads: Attach[] = [getTip(stalk)];
  for (let branch = 0; branch < 1 + variant; branch += 1) {
    const twig = growStem(
      {
        bend: 0.08,
        direction: fromAngles(random() * Math.PI * 2, 0.9),
        length: 0.08 + random() * 0.05,
        start: attachAlong(stalk, 0.62 + branch * 0.12).position,
        steps: 2,
        wobble: 0.05
      },
      random,
      attachAlong(stalk, 0.62 + branch * 0.12).path
    );
    addStemTube(builder, twig, [0.005, 0.003], 3, shaded(green, random));
    heads.push(getTip(twig));
  }
  for (const head of heads) {
    addHeadBody(builder, head, [0, 1, 0], [0.034, 0.02], shaded([0.32, 0.4, 0.2], random));
    const brush: Attach = { path: head.path, position: add(head.position, [0, 0.026, 0]) };
    addHeadBody(builder, brush, [0, 1, 0], [0.026, 0.017], shaded(rgb(0x9a4ab8), random));
  }
  return builder.finish({ contactRadius: 0.12, flex: 0.5 });
};
