import { smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { PropMesh, Vec3, VertexStyle } from "../props/mesh-builder";
import type { TubeUv } from "../props/tree-parts";
import { getLimbAlong, toBarkUv } from "./bark-uv";
import type { TreeLook, TreeModel, TreeWind, WoodLimb } from "./tree-model";

/** Grey-brown, weathered dead wood. */
const DEAD_WOOD: Vec3 = [0.5, 0.46, 0.41];

/** Bark tone at a height share: the foot colour turns into the upper trunk colour. */
const getConiferBarkTone = (look: TreeLook, heightShare: number): Vec3 => {
  const top = smoothstep(0.35, 0.72, heightShare);
  return [
    look.bark[0] + (look.barkTop[0] - look.bark[0]) * top,
    look.bark[1] + (look.barkTop[1] - look.bark[1]) * top,
    look.bark[2] + (look.barkTop[2] - look.bark[2]) * top
  ];
};

/**
 * Conifer wood colour on the island mesh (vertex colour): the archetype's bark
 * gradient up the tree, dead limbs grey, the crown's baked shade on top. Positions arrive in
 * island units.
 */
export const createConiferWoodStyle = (
  model: TreeModel,
  look: TreeLook,
  limb: WoodLimb,
  units: number,
  shadeAt: (point: Vec3) => number,
  random: Random
): VertexStyle => {
  const height = Math.max(model.bounds.height * units, 0.01);
  return {
    color: (position) => {
      const tone = limb.dead ? DEAD_WOOD : getConiferBarkTone(look, position[1] / height);
      const shade = shadeAt(position) * (0.94 + random() * 0.12);
      return [tone[0] * shade, tone[1] * shade, tone[2] * shade];
    },
    flutter: 0
  };
};

/** Bark relief coordinates of the archetype's bark family (no twist: conifer grain is straight). */
export const createConiferBarkUv = (look: TreeLook, limb: WoodLimb): TubeUv => {
  const along = getLimbAlong(limb.points, limb.radii);
  return (index, around) => toBarkUv(around, along[index]!, look.barkFamily);
};

/**
 * Island mesh bend weights: the root stays still, the whole tree sways with its height, and the
 * limb ends move with their reach from the trunk (long open-grown limbs).
 */
export const applyTreeWind = (mesh: PropMesh, { branch, trunk }: TreeWind) => {
  for (let vertex = 0; vertex < mesh.wind.length / 2; vertex += 1) {
    const relative = Math.max(0, mesh.positions[vertex * 3 + 1]! / mesh.height);
    const reach = Math.min(
      1,
      Math.hypot(mesh.positions[vertex * 3]!, mesh.positions[vertex * 3 + 2]!) / mesh.radius
    );
    mesh.wind[vertex * 2] =
      trunk * relative * relative + branch * Math.pow(reach, 1.5) * Math.sqrt(relative);
  }
  return mesh;
};

/** Archetype wind of a conifer (young trees sway more, see the archetype's TreeWind). */
export const applyConiferWind = (mesh: PropMesh, look: TreeLook) => applyTreeWind(mesh, look.wind);
