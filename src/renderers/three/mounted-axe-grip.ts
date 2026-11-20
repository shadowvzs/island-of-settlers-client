import { Object3D, Quaternion, Vector3 } from "three";

import { VIKING_AXE_GRIP_RADIUS } from "../../render-common/workers/viking-axe";
import { refineCompositeAxeGrip } from "./axe-composite-grip";
import { createAxeContactAlignment } from "./mounted-axe-contact";
import { type HandSurfaceSample, originalHandSurface, shaftPenetration } from "./mounted-axe-surface";

const fitFinger = (chain: Object3D[], axes: Vector3[], hand: Object3D, tip: Object3D, target: Vector3,
  samples: readonly HandSurfaceSample[], origin: Vector3, across: Vector3, radius: number) => {
  const original = chain.map(bone => bone.quaternion.clone()), angles = [0, 0, 0];
  const rotation = new Quaternion(), point = new Vector3();
  const pose = () => {
    for (let part = 0; part < chain.length; part++) chain[part]!.quaternion
      .copy(original[part]!).premultiply(rotation.setFromAxisAngle(axes[part]!, angles[part]!));
    hand.updateMatrixWorld(true);
  };
  const score = () => hand.worldToLocal(tip.getWorldPosition(point)).distanceToSquared(target) +
    shaftPenetration(samples, hand, origin, across, radius + .003);
  const refine = (step: number) => {
    for (let part = 0; part < chain.length; part++) {
      const saved = angles[part]!;
      let best = score(), bestAngle = saved;
      for (const sign of [-1, 1]) {
        angles[part] = Math.max(-.2, Math.min(1.6, saved + sign * step)); pose();
        const distance = score();
        if (distance < best) { best = distance; bestAngle = angles[part]!; }
      }
      angles[part] = bestAngle; pose();
    }
  };
  // One-time bounded fit in the original hand's space; no per-frame search or retargeting.
  for (const step of [.35, .15, .05]) for (let pass = 0; pass < 4; pass++) refine(step);
  return chain.map((bone, part) => {
    const grip = bone.quaternion.clone(); bone.quaternion.copy(original[part]!);
    return { bone, grip, original: new Quaternion() };
  });
};

/** Palm contacts derived from original skin and Hand wrist pivots, for mounted or manual foot axes. */
export const createMountedAxeGrip = (root: Object3D, dense = false) => {
  const fingers: { bone: Object3D; grip: Quaternion; original: Quaternion }[] = [];
  const sockets = ["Left", "Right"].map(side => {
    const hand = root.getObjectByName(`${side}Hand`), index = root.getObjectByName(`${side}HandIndex1`);
    const pinky = root.getObjectByName(`${side}HandPinky1`), thumb = root.getObjectByName(`${side}HandThumb1`);
    if (!hand || !index || !pinky || !thumb) return undefined;
    root.updateMatrixWorld(true);
    const local = (bone: Object3D) => hand.worldToLocal(bone.getWorldPosition(new Vector3()));
    const first = local(index), last = local(pinky), across = first.clone().sub(last).normalize();
    const base = first.clone().add(last).multiplyScalar(.5), forward = base.clone().normalize();
    const normal = new Vector3().crossVectors(across, forward).normalize();
    if (normal.dot(local(thumb)) < 0) normal.negate();
    const surface = originalHandSurface(root, hand, base, forward, normal, dense);
    if (surface.palmFront === undefined) return undefined;
    const radius = VIKING_AXE_GRIP_RADIUS[side as "Left" | "Right"];
    const socket = new Object3D(); socket.name = `socket_axe_${side === "Left" ? "L" : "R"}`;
    socket.position.copy(base).addScaledVector(normal, surface.palmFront + radius + .003).addScaledVector(forward, .005);
    hand.add(socket);
    const fits: Parameters<typeof refineCompositeAxeGrip>[1] = [];
    for (const name of ["Index", "Middle", "Ring", "Pinky", "Thumb"]) {
      const chain = [1, 2, 3].map(part => root.getObjectByName(`${side}Hand${name}${part}`));
      const tip = root.getObjectByName(`${side}Hand${name}4`);
      if (!tip || chain.some(bone => !bone?.parent)) continue;
      const start = local(chain[0]!);
      // Each finger wraps the same physical shaft, at its own place along the palm width.
      const target = socket.position.clone().addScaledVector(across, start.clone().sub(base).dot(across))
        .addScaledVector(normal, radius + .008).addScaledVector(forward, -.008);
      const direction = local(tip).sub(start).normalize();
      const axis = new Vector3().crossVectors(direction, target.clone().sub(start).normalize()).normalize();
      if (axis.lengthSq() < .5) axis.copy(across);
      const axes = chain.map(bone => {
        const world = axis.clone().applyQuaternion(hand.getWorldQuaternion(new Quaternion()));
        return world.applyQuaternion(bone!.parent!.getWorldQuaternion(new Quaternion()).invert());
      });
      const entries = fitFinger(chain as Object3D[], axes, hand, tip, target, surface.fingers.get(name) ?? [],
        socket.position, across, radius);
      fingers.push(...entries); fits.push({ entries, axes, tip, target });
      hand.updateMatrixWorld(true);
    }
    if (dense) socket.userData.sourceFitClearance = refineCompositeAxeGrip(hand, fits,
      [...surface.fingers.values()].flat(), socket.position, across, radius);
    return socket;
  });
  return { fingers, sockets, alignContacts: createAxeContactAlignment(root, sockets) };
};
