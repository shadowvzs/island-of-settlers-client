import type { Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, randomPerpendicular, scale } from "../props/tree-parts";
import type { ConiferShape } from "./conifer-shapes";
import { createLimb, deviate, growLimbPoints, tangentAt, valueAt } from "./limb-growth";
import type { FoliageSpray, TreeModel, WoodLimb } from "./tree-model";

/** What the conifer growers share while building one tree. */
export interface ConiferContext {
  /** Clump (sub-crown) id of every spray: one per limb or tier. */
  clumps: number[];
  /** Fresh shoot tips: lit a little brighter after the crown shading. */
  freshTips: FoliageSpray[];
  model: TreeModel;
  random: Random;
  shape: ConiferShape;
}

interface SprayPose {
  clump: number;
  /** Direction the shoot grows. */
  growth: Vec3;
  phase: number;
  position: Vec3;
  sway: number;
  /** Fresh shoot tip: brighter, light green. */
  tip: boolean;
  /** How much the card faces the sky (tier sprays tilt outwards). */
  up: number;
}

/** Every conifer draws the short-needle spray cell (foliage-atlas.ts NEEDLE_SPRAY_RECTS). */
const NEEDLE_CELL = 0;
/** Fresh shoot tips are a lighter, warmer green. */
const TIP_HUE = 0.35;

const addSpray = (context: ConiferContext, pose: SprayPose) => {
  const { random, shape } = context;
  const outward = normalize([pose.position[0], 0.25 + pose.up * 0.3, pose.position[2]]);
  const side = scale(randomPerpendicular(pose.growth, random), 0.5);
  const facing = add(add([0, 0.6 + pose.up, 0], scale(outward, 0.7)), scale(side, 0.8));
  const spray: FoliageSpray = {
    facing: normalize(facing),
    growth: normalize(add(add(pose.growth, side), [0, 0.1, 0])),
    hue: (random() - 0.5) * 0.7 + (pose.tip ? TIP_HUE : 0),
    outward,
    phase: pose.phase + random() * 0.2,
    position: pose.position,
    shade: 0.5,
    size: shape.spraySize * (0.75 + random() * 0.45),
    sway: pose.sway,
    variant: NEEDLE_CELL
  };
  context.model.foliage.push(spray);
  context.clumps.push(pose.clump);
  if (pose.tip) context.freshTips.push(spray);
};

/** Needle sprays along a shoot from `from` to the tip, on both sides, plus a tip tuft. */
export const addShootSprays = (
  context: ConiferContext,
  limb: WoodLimb,
  from: number,
  clump: number
) => {
  const { random, shape } = context;
  const steps = Math.max(
    2,
    Math.round((limb.points.length - 1) * 1.6 * shape.density * (1 - from))
  );
  for (let index = 0; index <= steps; index += 1) {
    const along = from + ((1 - from) * index) / steps;
    const pose = {
      clump,
      growth: tangentAt(limb.points, along),
      phase: limb.phase,
      position: pointAlong(limb.points, along),
      sway: valueAt(limb.sway, along),
      tip: along > 0.85,
      up: 0.2
    };
    addSpray(context, pose);
    if (random() < 0.35) addSpray(context, pose);
  }
  const tip = limb.points[limb.points.length - 1]!;
  const growth = tangentAt(limb.points, 1);
  for (let tuft = 0; tuft < 2; tuft += 1) {
    addSpray(context, {
      clump,
      growth,
      phase: limb.phase,
      position: tip,
      sway: 1,
      tip: true,
      up: 0.2
    });
  }
};

/** Flat fans of side shoots along the outer part of a tier branch. */
export const growSideShoots = (context: ConiferContext, branch: WoodLimb, clump: number) => {
  const { random, shape } = context;
  const reach = shape.width * shape.height;
  for (let along = Math.max(0.3, shape.foliageFrom); along < 0.9; along += 0.2 + random() * 0.1) {
    for (const side of [-1, 1]) {
      const direction = deviate(
        tangentAt(branch.points, along),
        0.75 + random() * 0.3,
        side > 0 ? 0 : Math.PI
      );
      const points = growLimbPoints(
        {
          direction: [direction[0], direction[1] * 0.2, direction[2]],
          length: (0.12 + 0.18 * (1 - along)) * reach + 0.08,
          start: pointAlong(branch.points, along),
          steps: 2,
          tropism: [0, -shape.sag * 0.3, 0],
          wobble: 0.05
        },
        random
      );
      const radius = valueAt(branch.radii, along) * 0.5;
      const sway: [number, number] = [valueAt(branch.sway, along), 1];
      const shoot = createLimb(points, [radius, radius * 0.3], 3, sway, branch.phase);
      context.model.wood.push(shoot);
      addShootSprays(context, shoot, 0.2, clump);
    }
  }
};

/** Upright tuft of sprays around the leader tip. */
export const addLeaderTuft = (context: ConiferContext, trunk: WoodLimb, clump: number) => {
  const { random } = context;
  for (let tuft = 0; tuft < 5; tuft += 1) {
    const along = 0.9 + tuft * 0.02;
    addSpray(context, {
      clump,
      growth: normalize([random() - 0.5, 2.5, random() - 0.5]),
      phase: trunk.phase,
      position: pointAlong(trunk.points, along),
      sway: 0.6,
      tip: true,
      up: 0.2
    });
  }
};
