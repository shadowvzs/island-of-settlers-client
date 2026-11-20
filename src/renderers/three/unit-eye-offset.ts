import { Box3, type Object3D, type SkinnedMesh, Vector3 } from "three";

/** Bind-space head vertices provide anatomy, rather than treating the neck's Head pivot as eyes. */
const headCorners = (body: Object3D, head: Object3D) => {
  let selected: SkinnedMesh | undefined, boneIndex = -1, largest = 0;
  body.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const index = mesh.skeleton.bones.findIndex(bone => bone === head);
    const count = mesh.geometry.getAttribute("position")?.count ?? 0;
    if (index < 0 || count <= largest || !mesh.geometry.getAttribute("skinIndex") ||
      !mesh.geometry.getAttribute("skinWeight")) return;
    selected = mesh; boneIndex = index; largest = count;
  });
  if (!selected) return undefined;
  const inverse = selected.skeleton.boneInverses[boneIndex];
  if (!inverse) return undefined;
  const positions = selected.geometry.getAttribute("position"), joints = selected.geometry.getAttribute("skinIndex");
  const weights = selected.geometry.getAttribute("skinWeight"), bounds = new Box3(), vertex = new Vector3();
  for (let index = 0; index < positions.count; index++) {
    let headWeight = 0;
    for (let channel = 0; channel < 4; channel++)
      if (joints.getComponent(index, channel) === boneIndex) headWeight += weights.getComponent(index, channel);
    if (headWeight < .65) continue;
    vertex.fromBufferAttribute(positions, index).applyMatrix4(selected.bindMatrix).applyMatrix4(inverse);
    bounds.expandByPoint(vertex);
  }
  if (bounds.isEmpty()) return undefined;
  return Array.from({ length: 8 }, (_, index) => new Vector3(
    index & 1 ? bounds.max.x : bounds.min.x,
    index & 2 ? bounds.max.y : bounds.min.y,
    index & 4 ? bounds.max.z : bounds.min.z));
};

/** Sample an existing posed rig. No duplicate rig, geometry, mixer or GPU ownership. */
export const createUnitEyeOffset = (body: Object3D, groundRoot: Object3D,
  renderOrigin?: () => { x: number; y: number; z: number }) => {
  const head = body.getObjectByName("Head") ?? body.getObjectByName("head");
  const point = new Vector3(), origin = new Vector3();
  const corner = new Vector3(), centre = new Vector3();
  let measured = false, corners: Vector3[] | undefined;
  return () => {
    if (!head) return undefined;
    head.updateWorldMatrix(true, false); groundRoot.updateWorldMatrix(true, false);
    if (!measured) { corners = headCorners(body, head); measured = true; }
    head.getWorldPosition(point);
    if (corners) {
      let bottom = Infinity, top = -Infinity;
      centre.set(0, 0, 0);
      for (const local of corners) {
        corner.copy(local).applyMatrix4(head.matrixWorld); centre.add(corner);
        bottom = Math.min(bottom, corner.y); top = Math.max(top, corner.y);
      }
      centre.multiplyScalar(1 / corners.length);
      point.set(centre.x, bottom + (top - bottom) * .72, centre.z);
    } else point.y += .035;
    if (renderOrigin) {
      const base = renderOrigin(); origin.set(base.x, base.y, base.z);
    } else groundRoot.getWorldPosition(origin);
    point.sub(origin);
    if (![point.x, point.y, point.z].every(Number.isFinite) || point.y < .3 || point.y > 2.55) return undefined;
    return { x: point.x, y: point.y, z: point.z };
  };
};
