import { createBoatGripOrientation } from "./worker-boat-grip-orientation";
import { boatTransferTransform, yardBoatRotationShare, yardBoatWorkerHeading, yardBoatWorldPose } from "./worker-boat-transfer";
import { Matrix4, type Object3D, Quaternion, Vector3 } from "three";

import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { createBoatArmApplicator } from "./worker-boat-elbow-clearance";
import { createBoatHeadClearance } from "./worker-boat-head-clearance";

/** The real tapered rail cross-section, in the carried hull's model-space coordinates. */
export const boatRimPoint = (side: number, along: number) => {
  const length = FISHING_SKIFF_LENGTH / WORKER_SCALE;
  const share = Math.max(0, Math.min(1, along / length + .5));
  const edge = Math.abs(share * 2 - 1), fine = 1 - edge ** 2.4;
  const beam = share < .5 ? Math.max(.42, fine) : fine;
  return new Vector3(side * FISHING_SKIFF_BEAM / (2 * WORKER_SCALE) * beam,
    .14 * .78 / WORKER_SCALE * edge ** 2, along);
};

/** Fit both real population arms to the rim of the drawn hull, including the wrist/socket offset. */
export const createBoatHandContacts = (root: Object3D) => {
  const { apply, alignWrist, relaxSocket } = createBoatArmApplicator(root);
  const headClearance = createBoatHeadClearance(root);
  const adaptGrip = createBoatGripOrientation();
  const target = new Vector3(), socketPosition = new Vector3(), handPosition = new Vector3();
  const pole = new Vector3(), rotation = new Quaternion(), parent = new Quaternion();
  const arms = ["Left", "Right"].map((side, index) => ({
    upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${index ? "R" : "L"}`),
    sign: index ? -1 : 1
  }));
  root.updateMatrixWorld(true);
  const grips = new Map(arms.flatMap(arm => {
    if (!arm.hand || !arm.socket) return [];
    const side = arm.sign > 0 ? "Left" : "Right", hand = arm.hand;
    const local = (name: string) => {
      const joint = root.getObjectByName(name);
      return joint ? hand.worldToLocal(joint.getWorldPosition(new Vector3())) : undefined;
    };
    const offset = hand.worldToLocal(arm.socket.getWorldPosition(new Vector3()));
    const forward = (local(side + "HandMiddle1") ?? offset.clone()).normalize();
    const index = local(side + "HandIndex1"), pinky = local(side + "HandPinky1");
    const normal = index && pinky ? forward.clone().cross(index.sub(pinky)).multiplyScalar(arm.sign)
      : new Vector3(0, -1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()).invert());
    normal.addScaledVector(forward, -normal.dot(forward)).normalize();
    const third = forward.clone().cross(normal).normalize();
    const inverse = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, normal, third)).invert();
    return [[arm.sign, { inverse, offset, forward: forward.clone(), normal: normal.clone() }] as const];
  }));
  const gripFromRotation = (world: Quaternion, sign: number, turn: number) => world.clone()
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI + Math.atan2(.6, .8)))
    .multiply(grips.get(sign)?.inverse ?? new Quaternion());
  const gripOrientation = (boat: Object3D, sign: number, turn: number) => gripFromRotation(boat.getWorldQuaternion(new Quaternion()), sign, turn);
  const socketOffset = (arm: typeof arms[number], orientation: Quaternion) => (grips.get(arm.sign)?.offset.clone() ?? new Vector3())
    .multiply(arm.hand!.getWorldScale(new Vector3())).applyQuaternion(orientation);
  const rimPoint = (boat: Object3D, side: number, along: number) => boatRimPoint(side, along)
    .add(new Vector3(0, boat.userData.fisherRailTop ?? 0, 0));
  const solve = (point: (sign: number, target: Vector3) => Vector3, reachWithTorso = false, clearHead?: () => void,
    orientationFor?: (sign: number) => Quaternion, swivelFor?: (sign: number) => number, motion?: { axis: Vector3; phase: number; mode: number; free: number; endpoint?: () => { point: Vector3; orientation: Quaternion; weight: number } }) => {
    const spine = root.getObjectByName("Spine"), head = root.getObjectByName("Head");
    const headOrientation = head?.getWorldQuaternion(new Quaternion());
    if (reachWithTorso && spine?.parent) {
      const original = spine.getWorldQuaternion(new Quaternion());
      for (let pass = 0; pass < 4; pass++) {
        root.updateMatrixWorld(true);
        const shift = new Vector3(), shoulders = new Vector3(); let count = 0;
        for (const arm of arms) {
          if (!arm.upper || !arm.lower || !arm.hand || !arm.socket) continue;
          const shoulder = arm.upper.getWorldPosition(new Vector3());
          const elbow = arm.lower.getWorldPosition(new Vector3()), wrist = arm.hand.getWorldPosition(new Vector3());
          const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
          const offset = orientationFor ? socketOffset(arm, orientationFor(arm.sign)) : arm.socket.getWorldPosition(new Vector3()).sub(wrist);
          const goal = point(arm.sign, new Vector3()).sub(offset);
          const direction = goal.sub(shoulder), distance = direction.length();
          if (distance > length * .98) shift.add(direction.multiplyScalar((distance - length * .98) / distance));
          shoulders.add(shoulder); count++;
        }
        if (!count || shift.lengthSq() < 1e-8) break;
        shift.divideScalar(count); shoulders.divideScalar(count);
        const lever = shoulders.sub(spine.getWorldPosition(new Vector3()));
        const adjustment = new Quaternion().setFromUnitVectors(lever.clone().normalize(), lever.add(shift).normalize());
        const proposed = adjustment.multiply(spine.getWorldQuaternion(new Quaternion()));
        const angle = original.angleTo(proposed);
        if (angle > .55) proposed.slerpQuaternions(original, proposed.clone(), .55 / angle);
        spine.quaternion.copy(spine.parent.getWorldQuaternion(new Quaternion()).invert().multiply(proposed));
      }
    }
    if (reachWithTorso && head?.parent && headOrientation)
      head.quaternion.copy(head.parent.getWorldQuaternion(new Quaternion()).invert().multiply(headOrientation));
    clearHead?.();
    for (const { hand, lower, sign, socket, upper } of arms) {
      if (!upper || !lower || !hand?.parent || !socket) continue;
      const baseOrientation = orientationFor?.(sign) ?? hand.getWorldQuaternion(rotation).clone();
      const orientation = baseOrientation.clone();
      hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(orientation));
      const passes = 4;
      for (let pass = 0; pass < passes; pass++) {
        root.updateMatrixWorld(true);
        if (pass > 0 && motion && grips.get(sign) && !(sign > 0 && motion.free > 0)) {
          const forearm = hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3())).normalize();
          orientation.copy(adaptGrip(baseOrientation, grips.get(sign)!.forward, forearm, motion.axis,
            sign, motion.phase, motion.mode, sign > 0 ? motion.free : 0));
          hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(orientation));
          root.updateMatrixWorld(true);
        }
        point(sign, target);
        target.sub(socket.getWorldPosition(socketPosition).sub(hand.getWorldPosition(handPosition)));
        const poleDown = motion?.mode === 1 ? 0 : -.75;
        pole.set(sign, poleDown, sign > 0 ? .75 : -.5).applyQuaternion(root.getWorldQuaternion(rotation));
        if (swivelFor) pole.applyAxisAngle(target.clone().sub(upper.getWorldPosition(new Vector3())).normalize(), swivelFor(sign));
        apply(upper, lower, hand, target, pole);
        alignWrist(lower, hand, orientation);
        hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(orientation));
      }
      if (sign > 0 && motion && motion.free > 0) {
        point(sign, target);
        const endpoint = motion.endpoint?.();
        if (endpoint) relaxSocket(upper, lower, hand, socket, target, pole,
          endpoint.point, endpoint.orientation, motion.axis, grips.get(sign)!.forward, endpoint.weight);
      }
      root.updateMatrixWorld(true);
      const finger = grips.get(sign)?.forward.clone().applyQuaternion(hand.getWorldQuaternion(new Quaternion()));
      const forearm = hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3())).normalize();
      if (finger) hand.userData.fisherWristBend = Math.acos(Math.max(-1, Math.min(1, finger.dot(forearm))));
    }
    root.updateMatrixWorld(true);
  };
  const sideLift = (boat: Object3D, lift: number, alongSign: number, wall?: { x: number; z: number; yaw: number }) => {
      const clamp = (n: number) => Math.max(0, Math.min(1, n));
      const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
      const change = alongSign > 0 ? ease((lift - .45) / .5) : ease((lift - .6) / .35), move = ease(lift);
      const points: Vector3[] = [], alongValues: number[] = [];
      const railReach = ease((lift - (alongSign > 0 ? .5 : .3)) / .1) * (1 - ease((lift - .82) / .12));
      const shoulderAlong = arms.map(arm => arm.upper
        ? Math.max(-.35, Math.min(.35, boat.worldToLocal(arm.upper.getWorldPosition(new Vector3())).z)) : 0);
      const release = alongSign > 0 ? .45 : .6, regrip = .95;
      const lead = -Math.PI / 3 * ease((lift - (release - .05)) / .1) * (1 - ease((lift - (release + .13)) / .14));
      const boatAt = (phase: number) => {
        if (wall) return yardBoatWorldPose({ ...wall, y: 0 }).rotation.slerp(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), wall.yaw + Math.PI / 2)
            .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)), yardBoatRotationShare(phase));
        return root.getWorldQuaternion(new Quaternion()).multiply(boatTransferTransform(phase).rotation);
      };
      const nearGrip = gripFromRotation(boatAt(release), 1, 0), farGrip = gripFromRotation(boatAt(regrip), 1, -Math.PI);
      const freeForward = new Vector3(.55, -.6, -.6).normalize(), freeNormal = new Vector3(-1, 0, 0);
      freeNormal.addScaledVector(freeForward, -freeNormal.dot(freeForward)).normalize();
      const freeFrame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(freeForward, freeNormal, freeForward.clone().cross(freeNormal)));
      const neutralRoot = wall ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yardBoatWorkerHeading(wall.yaw, (release + regrip) / 2))
        : root.getWorldQuaternion(new Quaternion());
      const relaxedGrip = neutralRoot.multiply(freeFrame).multiply(grips.get(1)?.inverse ?? new Quaternion());
      const handOrientation = (sign: number) => {
        if (sign < 0 || change === 0 || change === 1) return gripOrientation(boat, sign, sign > 0 ? -Math.PI * change : 0);
        return change < .5 ? nearGrip.clone().slerp(relaxedGrip, ease(change * 2))
          : relaxedGrip.clone().slerp(farGrip, ease((change - .5) * 2));
      };
      solve((sign, out) => {
        // Both hands first lift the upper gunwale. The left hand then passes
        // through the open hull to its opposite rail while the right supports it.
        const side = sign > 0 ? 1 - 2 * change : 1;
        const baseAlong = alongSign * sign * .13 * (1 - move) - .12 * move;
        const along = baseAlong + (shoulderAlong[sign > 0 ? 0 : 1]! - baseAlong) * railReach;
        alongValues[sign > 0 ? 0 : 1] = along;
        out.copy(rimPoint(boat, side, along));
        if (sign > 0) out.y += (alongSign > 0 ? -.03 : 0) * Math.sin(Math.PI * change);
        boat.localToWorld(out);
        // During the released left-hand transfer, keep the free hand within
        // its native reach. The supporting right hand remains on the rail.
        if (sign > 0 && change > 0 && change < 1) {
          const arm = arms[0]!;
          if (arm.upper && arm.lower && arm.hand && arm.socket) {
            const shoulder = arm.upper.getWorldPosition(new Vector3());
            const elbow = arm.lower.getWorldPosition(new Vector3()), wrist = arm.hand.getWorldPosition(new Vector3());
            const near = boat.localToWorld(rimPoint(boat, 1, along)).sub(shoulder);
            const far = boat.localToWorld(rimPoint(boat, -1, along)).sub(shoulder);
            let radius = near.length() + (far.length() - near.length()) * change;
            const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
            const pad = arm.socket.getWorldPosition(new Vector3()).distanceTo(wrist);
            const safeRadius = Math.max(.08, length * .98 - pad);
            radius -= Math.max(0, radius - safeRadius) * ease(Math.sin(Math.PI * change));
            const free = new Vector3(.55, -.6, -.6).applyQuaternion(root.getWorldQuaternion(new Quaternion())).normalize();
            const start = change < .5 ? near.normalize() : free;
            const end = change < .5 ? free : far.normalize();
            const share = ease(change < .5 ? change * 2 : (change - .5) * 2);
            const arc = new Quaternion().setFromUnitVectors(start, end);
            out.copy(start).applyQuaternion(new Quaternion().slerp(arc, share)).multiplyScalar(radius).add(shoulder);

          }
        }
        points[sign > 0 ? 0 : 1] = out.clone(); return out;
      }, true, () => headClearance(boat, wall),
        handOrientation, sign => sign > 0 ? lead : 0, { axis: new Vector3(0, 0, 1).applyQuaternion(boat.getWorldQuaternion(new Quaternion())), phase: lift, mode: alongSign, free: ease(Math.min(change / .1, (1 - change) / .1, 1)), endpoint: () => {
          const near = change < .5;
          const share = Math.min(1, near ? change / .25 : (1 - change) / .25);
          return { point: boat.localToWorld(rimPoint(boat, near ? 1 : -1, alongValues[0]!)),
            orientation: gripOrientation(boat, 1, near ? 0 : -Math.PI), weight: 1 - ease(share) };
        } });
      boat.userData.fisherTransferFreeHand = change > 0 && change < 1;
      boat.userData.fisherTransferGripPoints = points; boat.userData.fisherGripAlong = alongValues;
  };
  return {
    boat: (boat: Object3D, along = 0, depth = 0) => {
      delete boat.userData.fisherTransferGripPoints;
      delete boat.userData.fisherTransferFreeHand;
      boat.updateWorldMatrix(true, true);
      // Slide the paired grips along the real gunwales to the nearest reachable section.
      let best = along, bestCost = Infinity, bestSide = 1;
      const shoulder = new Vector3(), point = new Vector3();
      const halfLength = FISHING_SKIFF_LENGTH / (2 * WORKER_SCALE);
      for (let index = 0; index <= 48; index++) for (const mapping of [1, -1]) {
        const z = -halfLength * .9 + index / 48 * halfLength * 1.8;
        let cost = .005 * (z - along) ** 2;
        for (const arm of arms) {
          if (!arm.upper) continue;
          boat.localToWorld(point.copy(rimPoint(boat, arm.sign * mapping, z)));
          const distance = point.distanceTo(arm.upper.getWorldPosition(shoulder));
          cost += distance * distance + 20 * Math.max(0, distance - .34) ** 2;
        }
        if (cost < bestCost) { bestCost = cost; best = z; bestSide = mapping; }
      }
      boat.userData.fisherGripAlong = best; boat.userData.fisherGripSide = bestSide;
      solve((sign, out) => boat.localToWorld(out.copy(rimPoint(boat, sign * bestSide, best)).add(new Vector3(0, depth, 0))), false, undefined, sign => gripOrientation(boat, sign, sign * bestSide > 0 ? 0 : -Math.PI), undefined,
        { axis: new Vector3(0, 0, 1).applyQuaternion(boat.getWorldQuaternion(new Quaternion())), phase: 1, mode: 0, free: 0 });
    },
    yard: (boat: Object3D, lift: number, wall?: { x: number; z: number; yaw: number }) => sideLift(boat, lift, -1, wall),
    ground: (boat: Object3D, lift: number) => sideLift(boat, lift, 1),
    world: (points: NonNullable<import("../../render-common/workers/worker-unit").WorkerFrame["fisherBoatHands"]>) =>
      solve((sign, out) => {
        const point = points[sign > 0 ? 0 : 1];
        return out.set(point.x, point.y, point.z);
      })
  };
};
