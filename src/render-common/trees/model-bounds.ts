import type { Vec3 } from "../props/mesh-builder";
import type { TreeModel } from "./tree-model";

/** Height and horizontal radius of everything in the model (camera framing, culling). */
export const finishModel = (model: TreeModel): TreeModel => {
  let height = 0.1;
  let radius = 0.1;
  const include = (point: Vec3, extent = 0) => {
    height = Math.max(height, point[1] + extent);
    radius = Math.max(radius, Math.hypot(point[0], point[2]) + extent);
  };
  for (const limb of model.wood)
    limb.points.forEach((point, index) => include(point, limb.radii[index]));
  for (const spray of model.foliage) include(spray.position, spray.size * 0.6);
  for (const frond of model.fronds)
    frond.points.forEach((point, index) => include(point, frond.widths[index]));
  if (model.stump) include([0, model.stump.height, 0], model.stump.radius * model.stump.flare);
  model.bounds = { height, radius };
  return model;
};
