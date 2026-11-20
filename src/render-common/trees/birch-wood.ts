import type { Random } from "../../shared/world/rng";
import type { Vec3, VertexStyle } from "../props/mesh-builder";
import type { TubeUv } from "../props/tree-parts";
import { BARK_FAMILY, BIRCH_BRANCH_ALONG, getLimbAlong, toBarkUv } from "./bark-uv";
import { getBirchWoodTone } from "./birch-shape";
import type { TreeModel, WoodLimb } from "./tree-model";

const MATURE_BARK = { roughBase: 0.22, whiteness: 1 };

/** Bark along coordinate per point: branches start far above the trunk's rough base. */
const getBirchAlong = (limb: WoodLimb) => {
  const offset = limb.depth === 0 ? 0 : BIRCH_BRANCH_ALONG;
  return getLimbAlong(limb.points, limb.radii).map((along) => along + offset);
};

/** Bark colouring of a birch model (mature bark when the model has none). */
const getBirchBarkLook = (model: TreeModel) => model.bark ?? MATURE_BARK;

/**
 * Birch wood colour on the island mesh (vertex colour): the white trunk with
 * its darker base, pale primaries greying outwards, the crown's baked shade on top.
 * Positions arrive in island units, so height and length are measured in the same units.
 */
export const createBirchWoodStyle = (
  model: TreeModel,
  limb: WoodLimb,
  units: number,
  shadeAt: (point: Vec3) => number,
  random: Random
): VertexStyle => {
  const bark = getBirchBarkLook(model);
  const height = Math.max(model.bounds.height * units, 0.01);
  const start = limb.points[0]!;
  const tip = limb.points[limb.points.length - 1]!;
  const length = Math.max(
    Math.hypot(tip[0] - start[0], tip[1] - start[1], tip[2] - start[2]),
    1e-3
  );
  return {
    color: (position) => {
      const along = Math.min(
        1,
        Math.hypot(
          position[0] - start[0] * units,
          position[1] - start[1] * units,
          position[2] - start[2] * units
        ) /
          (length * units)
      );
      const tone = getBirchWoodTone(bark, limb.depth, along, position[1] / height);
      const shade = shadeAt(position) * (0.95 + random() * 0.1);
      return [tone[0] * shade, tone[1] * shade, tone[2] * shade];
    },
    flutter: 0
  };
};

/**
 * Birch bark coordinates (bark family birch): trunks and primaries carry the procedural marks,
 * branches start far above the rough trunk base; thinner wood keeps its plain colour.
 */
export const createBirchBarkUv = (limb: WoodLimb): TubeUv | undefined => {
  if (limb.depth >= 2) return undefined;
  const along = getBirchAlong(limb);
  return (index, around) => toBarkUv(around, along[index]!, BARK_FAMILY.birch);
};
