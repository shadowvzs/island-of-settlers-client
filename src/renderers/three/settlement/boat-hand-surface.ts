import { type Object3D, SkinnedMesh, Vector3 } from "three";

/** Actual native finger thickness, in world units, rather than a generic oversized fist. */
export const measureBoatFingerPadding = (body: Object3D) => {
  const samples = { Left: { finger: [] as number[], thumb: [] as number[] },
    Right: { finger: [] as number[], thumb: [] as number[] } };
  const point = new Vector3(), offset = new Vector3();
  // SkinnedMesh.updateMatrixWorld also refreshes the attached bind-matrix inverse.
  // updateWorldMatrix alone leaves it stale after applying the worker's scale.
  body.updateMatrixWorld(true);
  body.traverse(object => {
    if (!(object instanceof SkinnedMesh) || !object.visible) return;
    object.skeleton.update();
    const indices = object.geometry.getAttribute("skinIndex"), weights = object.geometry.getAttribute("skinWeight");
    const segments = object.skeleton.bones.map(bone => {
      const match = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.exec(bone.name);
      if (!match) return undefined;
      const start = bone.getWorldPosition(new Vector3());
      const end = bone.children[0]?.getWorldPosition(new Vector3()) ?? start.clone()
        .add(start.clone().sub(bone.parent!.getWorldPosition(new Vector3())).multiplyScalar(.7));
      return { side: match[1] as "Left" | "Right", kind: match[2] === "Thumb" ? "thumb" as const : "finger" as const,
        start, axis: end.sub(start) };
    });
    const used = new Set<number>(object.geometry.index?.array ?? Array.from({ length: indices.count }, (_, i) => i));
    for (const index of used) {
      let joint = 0, weight = 0;
      for (let component = 0; component < 4; component++) if (weights.getComponent(index, component) > weight) {
        weight = weights.getComponent(index, component); joint = indices.getComponent(index, component);
      }
      const segment = segments[joint];
      if (!segment || weight < .5 || segment.axis.lengthSq() < 1e-10) continue;
      object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
      offset.copy(point).sub(segment.start);
      const along = offset.dot(segment.axis) / segment.axis.lengthSq();
      if (along < .15 || along > .85) continue;
      const radius = offset.addScaledVector(segment.axis, -along).length();
      samples[segment.side][segment.kind].push(radius);
    }
  });
  const thickness = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length * .65)] ?? .006;
  };
  return { Left: { finger: thickness(samples.Left.finger), thumb: thickness(samples.Left.thumb), palm: .002 },
    Right: { finger: thickness(samples.Right.finger), thumb: thickness(samples.Right.thumb), palm: .002 } };
};
