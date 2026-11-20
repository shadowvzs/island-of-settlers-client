import type { ResourceTarget } from "./settlement-types";

export const resourceApproaches = (target: ResourceTarget) => {
  if (target.approach) return [target.approach];
  if (target.kind !== "tree" && target.kind !== "stone") return [target];
  return [
    { x: target.x + 0.8, z: target.z },
    { x: target.x - 0.8, z: target.z },
    { x: target.x, z: target.z + 0.8 },
    { x: target.x, z: target.z - 0.8 }
  ];
};
