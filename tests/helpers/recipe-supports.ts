import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";

import type { BuildingPart, BuildingRecipe } from "../../src/render-common/buildings/building-recipe";

/** Conservative rotated bounds: finds detached prop assemblies, including tiny cut-end caps. */
const partBounds = (part: BuildingPart) => {
  const rotation = new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]), "ZYX"));
  const matrix = new Matrix4().compose(
    new Vector3(...part.position),
    rotation,
    new Vector3(...part.size)
  );
  const bounds = new Box3();
  const bottom = part.shape === "tile" ? -0.12 : -0.5;
  for (const x of [-0.5, 0.5])
    for (const y of [bottom, 0.5])
      for (const z of [-0.5, 0.5]) {
        const fraction = y + 0.5;
        const scale = part.topScale ?? [1, 1, 1];
        const offset = part.topOffset ?? [0, 0, 0];
        bounds.expandByPoint(
          new Vector3(
            x * (1 + (scale[0] - 1) * fraction) + (offset[0] * fraction) / part.size[0],
            y,
            z * (1 + (scale[2] - 1) * fraction) + (offset[2] * fraction) / part.size[2]
          ).applyMatrix4(matrix)
        );
      }
  return bounds;
};
/** Parts that no chain of touching parts connects to the ground. */
export const unsupportedParts = (recipe: BuildingRecipe) => {
  const bounds = recipe.parts.map(partBounds);
  const connected = new Set<number>();
  const pending: number[] = [];
  bounds.forEach((box, index) => {
    if (box.min.y <= 0.001) {
      connected.add(index);
      pending.push(index);
    }
  });
  while (pending.length) {
    const source = bounds[pending.pop()!]!.clone().expandByScalar(0.012);
    bounds.forEach((box, index) => {
      if (connected.has(index) || !source.intersectsBox(box)) return;
      connected.add(index);
      pending.push(index);
    });
  }
  return recipe.parts
    .filter((_part, index) => !connected.has(index))
    .map((part) => ({ shape: part.shape, surface: part.surface, position: part.position }));
};

