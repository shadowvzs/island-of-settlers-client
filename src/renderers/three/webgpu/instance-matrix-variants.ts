import type { InstancedBufferAttribute, Material, Object3D } from "three/webgpu";

import { PropNodeMaterial } from "../../webgpu/tsl/props";

type Matrix = InstancedBufferAttribute;

/**
 * The prop node materials read the instance matrix through node attributes resolved when the node
 * is built (prop-instance.ts); Three keys that build by material and object, not by the matrix. A
 * mesh that swaps its `instanceMatrix` (the prop buffers grew, or the FPS caster got buffers of
 * its own) kept the old matrices with the new instance data: Ultra drew tree shadows where no tree
 * stands. Every later matrix of an object draws through a clone tagged with that matrix's id (a
 * numeric material property is part of Three's render object key), so it builds against it.
 */
export const createInstanceMatrixVariants = () => {
  const firstMatrix = new WeakMap<Object3D, Matrix>();
  const variants = new WeakMap<Material, WeakMap<Matrix, Material>>();

  const variantOf = (material: Material, matrix: Matrix) => {
    let byMatrix = variants.get(material);
    if (byMatrix === undefined) variants.set(material, byMatrix = new WeakMap());
    let variant = byMatrix.get(matrix);
    if (variant === undefined) {
      variant = material.clone();
      (variant as Material & { wgInstanceMatrix?: number }).wgInstanceMatrix = matrix.id;
      byMatrix.set(matrix, variant);
    }
    return variant;
  };

  return (material: Material, object: Object3D): Material => {
    if (!(material instanceof PropNodeMaterial)) return material;
    const matrix = (object as { instanceMatrix?: Matrix }).instanceMatrix;
    if (matrix === undefined) return material;
    const first = firstMatrix.get(object);
    if (first === undefined) firstMatrix.set(object, matrix);
    return first === undefined || first === matrix ? material : variantOf(material, matrix);
  };
};
