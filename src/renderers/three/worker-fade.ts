import { type Material, Mesh, type Object3D } from "three";

interface FadedMesh {
  mesh: Mesh;
  original: Material | Material[];
}

/** `clone` drops shader patches (livery, terrain feet): the copy keeps the original's patch and program key. */
const transparentCopy = (material: Material) => {
  const copy = material.clone();
  copy.onBeforeCompile = material.onBeforeCompile;
  copy.customProgramCacheKey = material.customProgramCacheKey;
  copy.userData = material.userData;
  copy.transparent = true;
  return copy;
};

/**
 * Per-figure opacity for a short fade (a cut-off carrier moving to storage, a map script's fade). Body, LOD,
 * prop and equipment materials are shared between figures, so a fading figure borrows transparent copies only
 * while it fades and gets its shared materials back at full opacity: steady figures pay nothing. Meshes that
 * attach during the fade (a soldier's shield and weapon load after the body) are adopted on the next step.
 */
export const createWorkerFade = (root: Object3D) => {
  let faded: FadedMesh[] = [];
  /** Each copy with its material's own opacity (the contact shadow ring is already translucent). */
  let copies: { base: number; material: Material }[] = [];
  let current = 1;
  /** Meshes already on transparent copies (props and equipment load later and join while the fade runs). */
  let adopted = new WeakSet<Mesh>();
  const begin = () => {
    root.traverse(object => {
      if (!(object instanceof Mesh) || adopted.has(object)) return;
      adopted.add(object);
      const original = object.material as Material | Material[];
      const copied = Array.isArray(original) ? original.map(transparentCopy) : transparentCopy(original);
      for (const material of Array.isArray(copied) ? copied : [copied])
        copies.push({ base: material.opacity, material });
      faded.push({ mesh: object, original });
      object.material = copied;
    });
  };
  const end = () => {
    for (const { mesh, original } of faded) mesh.material = original;
    for (const copy of copies) copy.material.dispose();
    faded = [];
    copies = [];
    adopted = new WeakSet();
  };
  return {
    dispose: end,
    /** Opacity 0–1; 1 restores the shared materials. */
    set: (opacity: number) => {
      const next = Math.max(0, Math.min(1, opacity));
      if (next === current) return;
      if (next >= 1) end();
      else begin();
      current = next;
      for (const copy of copies) copy.material.opacity = copy.base * next;
    }
  };
};
