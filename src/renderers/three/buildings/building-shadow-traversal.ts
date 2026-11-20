import { type Group, Matrix4, Mesh, type Object3D } from "three";

export type BuildingShadowVisit = (
  mesh: Mesh,
  relativeMatrix: Matrix4,
  visible: boolean
) => void;

const IDENTITY = new Matrix4();

type ShadowMesh = Mesh & {
  isBatchedMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
};

/** Static merged depth geometry cannot reproduce instancing, skinning or multi-draw batching. */
export const isBuildingShadowMeshSource = (mesh: Mesh) => {
  const candidate = mesh as ShadowMesh;
  return !candidate.isBatchedMesh && !candidate.isInstancedMesh && !candidate.isSkinnedMesh;
};

const hasFiniteConstructionCourses = (object: Object3D) => {
  const courses = object.userData.constructionCourses as
    | { height?: { value?: number } }
    | undefined;
  return Number.isFinite(courses?.height?.value);
};

/**
 * Visits meshes with transforms composed down from the source root.
 * The source root's own matrix is deliberately excluded; it moves the merged caster root.
 */
export const walkBuildingShadowMeshes = (
  root: Group,
  matrices: WeakMap<Object3D, Matrix4>,
  visit: BuildingShadowVisit
) => {
  const walk = (object: Object3D, parentMatrix: Matrix4, parentVisible: boolean) => {
    let relativeMatrix = IDENTITY;
    if (object !== root) {
      if (object.matrixAutoUpdate) object.updateMatrix();
      relativeMatrix = matrices.get(object) ?? new Matrix4();
      matrices.set(object, relativeMatrix);
      relativeMatrix.multiplyMatrices(parentMatrix, object.matrix);
    }
    const visible = parentVisible && object.visible && !hasFiniteConstructionCourses(object);
    if (object instanceof Mesh) visit(object, relativeMatrix, visible);
    for (const child of object.children) walk(child, relativeMatrix, visible);
  };
  walk(root, IDENTITY, true);
};
