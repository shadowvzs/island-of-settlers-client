import { DoubleSide, MeshStandardMaterial } from "three";

const shadows = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>();

/** All building instances borrow one alpha-black material from their existing shared pack owner. */
export const windowShadowMaterial = (source: MeshStandardMaterial) => {
  const cached = shadows.get(source);
  if (cached) return cached;
  // Depth-tested but never depth-writing: a figure in front of the insert (a window soldier) always wins,
  // whatever order the passes draw in.
  const material = new MeshStandardMaterial({ color: 0x000000, opacity: .5, transparent: true,
    depthTest: true, depthWrite: false, roughness: 1, metalness: 0, side: DoubleSide, vertexColors: false });
  material.forceSinglePass = true;
  material.name = "building-window-shadow-black-50";
  const release = () => {
    source.removeEventListener("dispose", release);
    shadows.delete(source); material.dispose();
  };
  source.addEventListener("dispose", release);
  shadows.set(source, material);
  return material;
};
