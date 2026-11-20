import { type Object3D, Quaternion, SkinnedMesh, Vector3 } from "three";

type Side = "Left" | "Right";
/** Calibrate native phalanges once against the actual deformed skin and shaft, keeping the palm fixed. */
export const createBoatFingerContactFit = (body: Object3D) => {
  const fingers = new Map<Side, Array<{ bones: Object3D[]; vertices: Array<{ mesh: SkinnedMesh; index: number; distal: boolean }>; correction?: Quaternion[] }>>();
  for (const side of ["Left", "Right"] as const) {
    const digits = ["Thumb", "Index", "Middle", "Ring", "Pinky"].map(name => ({ name,
      bones: [1, 2, 3].map(at => body.getObjectByName(`${side}Hand${name}${at}`)!),
      vertices: [] as Array<{ mesh: SkinnedMesh; index: number; distal: boolean }>, correction: undefined as Quaternion[] | undefined }));
    body.traverse(mesh => {
      if (!(mesh instanceof SkinnedMesh) || !mesh.visible) return;
      for (let ancestor: Object3D | null = mesh.parent; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
      const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      const used = new Set<number>(mesh.geometry.index?.array ?? Array.from({ length: joints.count }, (_, i) => i));
      for (const index of used) {
        let joint = 0, weight = 0;
        for (let k = 0; k < 4; k++) if (weights.getComponent(index, k) > weight) {
          weight = weights.getComponent(index, k); joint = joints.getComponent(index, k);
        }
        const name = mesh.skeleton.bones[joint]!.name, digit = digits.find(item => name.startsWith(`${side}Hand${item.name}`));
        if (weight >= .5 && digit) digit.vertices.push({ mesh, index, distal: name.endsWith("3") });
      }
    });
    for (const digit of digits) if (!digit.vertices.some(vertex => vertex.distal))
      digit.vertices.forEach(vertex => { vertex.distal = true; });
    fingers.set(side, digits);
  }
  const point = new Vector3(), relative = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), turn = new Quaternion();
  return (side: Side, centre: Vector3, shaft: Vector3, crossX: Vector3, crossY: Vector3) => {
    for (const digit of fingers.get(side)!) {
      if (!digit.vertices.length) continue;
      const original = digit.bones.map(bone => bone.quaternion.clone());
      const localFlex = digit.bones.map(bone => shaft.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()));
      const warm = Boolean(digit.correction);
      if (digit.correction) digit.bones.forEach((bone, index) => bone.quaternion.multiply(digit.correction![index]!));
      const meshes = new Set(digit.vertices.map(vertex => vertex.mesh));
      let needsFit = true;
      let diagnostic: Record<string, unknown> = {};
      const score = () => {
        body.updateMatrixWorld(true); for (const mesh of meshes) mesh.skeleton.update();
        let penetration = 0, deepest = 0, contact = Infinity, bottom = -Infinity;
        for (const vertex of digit.vertices) {
          vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld);
          relative.copy(point).sub(centre);
          const x = relative.dot(crossX), y = relative.dot(crossY), radius = .0118 + relative.dot(shaft) * .00634;
          const gap = (Math.abs(x) + Math.abs(y) - radius) / Math.SQRT2;
          penetration += Math.min(0, gap - .0005) ** 2;deepest=Math.min(deepest,gap);
          if (vertex.distal) { contact = Math.min(contact, Math.abs(gap - .001)); bottom = Math.max(bottom, -y); }
        }
        needsFit = deepest < -.001 || contact > .0035 || bottom < 0;
        diagnostic = { deepest, contact, bottom, centre: centre.toArray(), shaft: shaft.toArray(), crossX: crossX.toArray(), crossY: crossY.toArray() };
        const deviation = digit.bones.reduce((sum, bone, index) => sum + bone.quaternion.angleTo(original[index]!) ** 2, 0);
        return deepest * deepest * 1000 + penetration * 200 / Math.max(1, digit.vertices.length) + Math.min(.1, contact) ** 2 +
          Math.max(0, .002 - bottom) ** 2 * .1 + deviation * .000001;
      };
      let best = score();
      if (warm && !needsFit) continue;
      for (const step of (warm ? [.04, .02] : [.35, .2, .1, .05, .025])) for (let sweep = 0; sweep < (warm ? 1 : 3); sweep++) for (const bone of digit.bones) for (const flexAxis of ((bone === digit.bones[0] || digit.bones[0]!.name.includes("Thumb")) ? [shaft, crossX, crossY] : [shaft])) {
        const current = bone.quaternion.clone(); let selected = current;
        for (const sign of [-1, 1]) {
          bone.quaternion.copy(current); body.updateMatrixWorld(true);
          bone.getWorldQuaternion(world); const axis = bone !== digit.bones[0] && !digit.bones[0]!.name.includes("Thumb")
            ? localFlex[digit.bones.indexOf(bone)]!.clone().applyQuaternion(world) : flexAxis;
          turn.setFromAxisAngle(axis, step * sign).multiply(world);
          bone.quaternion.copy(bone.parent!.getWorldQuaternion(parent).invert().multiply(turn));
          const value = score(); if (value < best) { best = value; selected = bone.quaternion.clone(); }
        }
        bone.quaternion.copy(selected);
      }
      digit.correction = digit.bones.map((bone, index) => original[index]!.clone().invert().multiply(bone.quaternion));
      score();
      body.userData.boatFingerFits ??= {};
      body.userData.boatFingerFits[digit.bones[0]!.name] = diagnostic;
    }
    body.updateMatrixWorld(true);
  };
};
