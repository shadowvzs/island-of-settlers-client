import { AlwaysStencilFunc, type Material, type RenderItem, ReplaceStencilOp, type WebGLRenderer } from "three";

/** The stencil bit an excluded surface leaves where it is drawn (R12b ambient occlusion mask). */
export const AO_EXCLUDED_STENCIL_BIT = 0x80;

/**
 * Marks a material's visible pixels as "no ambient occlusion" (water, impostor cards): it writes
 * AO_EXCLUDED_STENCIL_BIT wherever it passes the depth test, and the compositor clears the AO weight
 * there before the resolve. A later surface in front never clears the bit by itself: inside the
 * main scene `aoExcludedLastOpaqueSort` draws these materials after the other opaque surfaces, and
 * the layers drawn after the main scene clear it through `renderAsAmbientOcclusionReceivers`.
 * Only the AO scene target has stencil bits: on every other target (the canvas, the plain scene
 * target, shadow and refraction targets) the write is a no-op, so the material renders exactly as
 * before.
 */
export const excludeFromAmbientOcclusion = <T extends Material>(material: T): T => {
  material.stencilWrite = true;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilRef = AO_EXCLUDED_STENCIL_BIT;
  material.stencilWriteMask = AO_EXCLUDED_STENCIL_BIT;
  material.stencilZPass = ReplaceStencilOp;
  return material;
};

/** Three numbers every material at creation (its default opaque sort key); the typings omit it. */
const materialId = (item: RenderItem) => (item.material as Material & { readonly id: number }).id;

const isAoExcluded = (material: Material) =>
  material.stencilWrite && material.stencilRef === AO_EXCLUDED_STENCIL_BIT;

/**
 * WALL-PATCHES: Three's opaque order (group order, render order, material id, front to back) with
 * AO-excluded materials after the rest of their render order. Drawn earlier, the sea or a far
 * impostor card left its stencil bit behind a nearer wall, column or roof that later covered it, and
 * that wall lost its occlusion in blotchy, sprite-shaped patches along the horizon.
 */
export const aoExcludedLastOpaqueSort = (a: RenderItem, b: RenderItem) => {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const excluded = Number(isAoExcluded(a.material)) - Number(isAoExcluded(b.material));
  if (excluded !== 0) return excluded;
  if (materialId(a) !== materialId(b)) return materialId(a) - materialId(b);
  if (a.materialVariant !== b.materialVariant) return a.materialVariant - b.materialVariant;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
};

/**
 * WALL-PATCHES: draws layers that follow the main scene (buildings, animals, workers, mounts) as AO
 * receivers: every fragment they leave clears AO_EXCLUDED_STENCIL_BIT. The sea and far impostor cards
 * of the main scene marked their pixels before a building in front was drawn; without this the wall
 * kept the mark and lost its occlusion in light, sprite-shaped patches along the horizon. Three's
 * stencil lock keeps the clearing state over materials that do not write stencil themselves; on a
 * target without stencil bits (AO off, Minimal) the state has no effect.
 */
export const renderAsAmbientOcclusionReceivers = (renderer: WebGLRenderer, draw: () => void) => {
  const gl = renderer.getContext();
  const stencil = renderer.state.buffers.stencil;
  stencil.setTest(true);
  stencil.setMask(AO_EXCLUDED_STENCIL_BIT);
  stencil.setFunc(gl.ALWAYS, 0, AO_EXCLUDED_STENCIL_BIT);
  stencil.setOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  stencil.setLocked(true);
  try {
    draw();
  } finally {
    stencil.setLocked(false);
    stencil.setTest(false);
  }
};
