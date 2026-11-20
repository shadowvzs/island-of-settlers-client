import {
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Vector3} from "three";

type Point = { x: number; z: number };

/**
 * Pale road colour, translucent; each road step shows one dash, so the route reads as planned.
 * Slightly lifted over the ground, depth tested so buildings and trees in front cover it.
 */
const DASH = { colour: 0xf6e2b4, fill: 0.85, lift: 0.08, opacity: 0.74, width: 0.12 } as const;
const MIN_CAPACITY = 64;

/**
 * The planned road of the hovered plot as a dashed, translucent ribbon over the terrain: one
 * instanced flat dash per road step, tilted with the ground. Rewritten only when a new route
 * array arrives; one draw call.
 */
export const createPlacementRoadDashes = (parent: Object3D, getHeight: (x: number, z: number) => number) => {
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: DASH.colour, depthWrite: false, opacity: DASH.opacity,
    transparent: true });
  const along = new Vector3(), across = new Vector3(), normal = new Vector3(), matrix = new Matrix4();
  let mesh: InstancedMesh | null = null, shown: readonly Point[] | null = null;

  const meshFor = (dashes: number) => {
    if (mesh && mesh.instanceMatrix.count >= dashes) return mesh;
    if (mesh) { mesh.removeFromParent(); mesh.dispose(); }
    let capacity = MIN_CAPACITY;
    while (capacity < dashes) capacity *= 2;
    mesh = new InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    mesh.name = "placement_road_preview";
    parent.add(mesh);
    return mesh;
  };

  /** A dash centred on the step from `start` to `end`, following the ground's slope. */
  const writeDash = (target: InstancedMesh, index: number, start: Point, end: Point) => {
    const startY = getHeight(start.x, start.z), endY = getHeight(end.x, end.z);
    along.set(end.x - start.x, endY - startY, end.z - start.z);
    const length = along.length();
    along.multiplyScalar(1 / length);
    across.set(-along.z, 0, along.x).normalize();
    normal.crossVectors(across, along);
    along.multiplyScalar(length * DASH.fill);
    across.multiplyScalar(DASH.width);
    matrix.makeBasis(along, normal, across).setPosition((start.x + end.x) / 2,
      (startY + endY) / 2 + DASH.lift, (start.z + end.z) / 2);
    target.setMatrixAt(index, matrix);
  };

  const update = (points: readonly Point[] | null) => {
    if (points === shown) return;
    shown = points;
    if (!points || points.length < 2) { if (mesh) mesh.visible = false; return; }
    const target = meshFor(points.length - 1);
    for (let index = 1; index < points.length; index++) writeDash(target, index - 1, points[index - 1]!, points[index]!);
    target.count = points.length - 1;
    target.instanceMatrix.needsUpdate = true;
    target.visible = true;
  };

  const dispose = () => {
    mesh?.removeFromParent();
    mesh?.dispose();
    geometry.dispose();
    material.dispose();
  };

  return { dispose, update };
};
