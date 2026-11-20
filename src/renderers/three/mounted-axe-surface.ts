import { type Object3D, type SkinnedMesh, Vector3 } from "three";

export interface HandSurfaceSample { mesh: SkinnedMesh; vertex: number }

/** Source skin points, evaluated from original rest vertices and existing bone matrices only. */
export const originalHandSurface = (root: Object3D, hand: Object3D, base: Vector3, forward: Vector3, normal: Vector3,
  dense = false) => {
  const palm: number[] = [], fingers = new Map<string, HandSurfaceSample[]>(), point = new Vector3();
  root.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.name.startsWith("armour_")) return;
    const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    const names = mesh.skeleton.bones.map(bone => bone.name);
    for (let vertex = 0; vertex < joints.count; vertex++) {
      let palmWeight = 0, handWeight = 0;
      const fingerWeights = new Map<string, number>();
      for (let channel = 0; channel < 4; channel++) {
        const name = names[joints.getComponent(vertex, channel)]!, weight = weights.getComponent(vertex, channel);
        if (name === hand.name) palmWeight += weight;
        if (!name.startsWith(hand.name)) continue;
        handWeight += weight;
        const finger = /Hand(Thumb|Index|Middle|Ring|Pinky)/.exec(name)?.[1];
        if (finger) fingerWeights.set(finger, (fingerWeights.get(finger) ?? 0) + weight);
      }
      for (const [finger, weight] of fingerWeights) if (dense ? weight > 0 && handWeight >= .4 : weight >= .4) {
        const samples = fingers.get(finger) ?? []; samples.push({ mesh, vertex }); fingers.set(finger, samples);
      }
      if (palmWeight < .4) continue;
      hand.worldToLocal(mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)).sub(base);
      const along = point.dot(forward);
      if (along >= -.04 && along <= .005) palm.push(point.dot(normal));
    }
  });
  palm.sort((a, b) => a - b);
  for (const [finger, samples] of fingers) {
    const stride = dense ? 1 : Math.max(1, Math.ceil(samples.length / 80));
    fingers.set(finger, samples.filter((_, index) => index % stride === 0));
  }
  return { palmFront: palm[Math.floor((palm.length - 1) * (dense ? 1 : .95))], fingers };
};

export const shaftPenetration = (samples: readonly HandSurfaceSample[], hand: Object3D,
  origin: Vector3, axis: Vector3, radius: number) => {
  const point = new Vector3();
  let squared = 0, maximum = 0;
  for (const { mesh, vertex } of samples) {
    hand.worldToLocal(mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)).sub(origin);
    const distance = point.addScaledVector(axis, -point.dot(axis)).length();
    const depth = Math.max(0, radius - distance);
    squared += depth * depth; maximum = Math.max(maximum, depth);
  }
  return squared / Math.max(1, samples.length) * 20 + maximum * maximum * 40;
};
