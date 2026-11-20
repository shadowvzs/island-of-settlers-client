import { MeshStandardMaterial } from "three";

/** Cast silver iron has broad rough reflections; the chamfer geometry supplies its edge highlights. */
export const createIronIngotMaterial = (source?: MeshStandardMaterial) => {
  const material = source?.clone() ?? new MeshStandardMaterial();
  material.color.set(source?.map ? "#e0e4e7" : "#a4afb6");
  material.metalness = .78; material.roughness = .43; material.vertexColors = true;
  material.normalScale.set(.12, .12);
  return material;
};
