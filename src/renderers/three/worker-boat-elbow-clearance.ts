import { Matrix4, type Object3D, Quaternion, Vector3 } from "three";

/** Explicit native hinge frames avoid inheriting axial flips from the old pickup clip. */
export const createBoatArmApplicator = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const calibration = new Map<Object3D, { upper: Quaternion; lower: Quaternion; wrist: Quaternion; normal: Vector3 }>();
  const front = new Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new Quaternion()));
  const basis = (direction: Vector3, normal: Vector3) => new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(direction, normal.clone().cross(direction).normalize(), normal));
  for (const side of ["Left", "Right"]) {
    const upper = root.getObjectByName(side + "Arm"), lower = root.getObjectByName(side + "ForeArm"), hand = root.getObjectByName(side + "Hand");
    if (!upper || !lower || !hand) continue;
    const frame = (bone: Object3D, child: Object3D) => {
      const direction = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
      const normal = direction.clone().cross(front).normalize();
      const inverse = bone.getWorldQuaternion(new Quaternion()).invert();
      return basis(direction.applyQuaternion(inverse), normal.applyQuaternion(inverse)).invert();
    };
    calibration.set(lower, { upper: frame(upper, lower), lower: frame(lower, hand),
      wrist: lower.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion())),
      normal: hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3())).normalize().cross(front)
        .normalize().applyQuaternion(lower.getWorldQuaternion(new Quaternion()).invert()) });
  }
  const shoulder = new Vector3(), elbow = new Vector3(), wrist = new Vector3();
  const axis = new Vector3(), bend = new Vector3(), wantedElbow = new Vector3(), wantedWrist = new Vector3();
  const normal = new Vector3(), direction = new Vector3(), parent = new Quaternion();
  const apply = (upper: Object3D, lower: Object3D, hand: Object3D, target: Vector3, pole: Vector3, socketLocal?: Vector3, referenceOverride?: Quaternion) => {
    const binding = calibration.get(lower);
    if (!upper.parent || !lower.parent || !binding) return;
    upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow); hand.getWorldPosition(wrist);
    const extended = socketLocal?.clone().multiply(lower.getWorldScale(new Vector3()));
    const first = shoulder.distanceTo(elbow), second = extended?.length() ?? elbow.distanceTo(wrist);
    const distance = Math.max(Math.abs(first - second) + 1e-6, Math.min(shoulder.distanceTo(target), (first + second) * .9995));
    axis.copy(target).sub(shoulder).normalize(); bend.copy(pole).addScaledVector(axis, -pole.dot(axis)).normalize();
    const along = (first * first - second * second + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, first * first - along * along));
    wantedElbow.copy(shoulder).addScaledVector(axis, along).addScaledVector(bend, height);
    wantedWrist.copy(shoulder).addScaledVector(axis, distance);
    normal.copy(wantedElbow).sub(shoulder).cross(direction.copy(wantedWrist).sub(wantedElbow)).normalize();
    direction.copy(wantedElbow).sub(shoulder).normalize();
    const upperWorld = basis(direction, normal).multiply(binding.upper);
    upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert().multiply(upperWorld));
    root.updateMatrixWorld(true);
    direction.copy(wantedWrist).sub(wantedElbow).normalize();
    let lowerReference = binding.lower;
    if (extended) {
      extended.normalize();
      const referenceNormal = binding.normal.clone().addScaledVector(extended, -binding.normal.dot(extended)).normalize();
      lowerReference = basis(extended, referenceNormal).invert();
    }
    const lowerWorld = basis(direction, normal).multiply(referenceOverride ?? lowerReference);
    lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert().multiply(lowerWorld));
    root.updateMatrixWorld(true);
  };
  const alignWrist = (lower: Object3D, hand: Object3D, desired: Quaternion) => {
    const binding = calibration.get(lower);
    if (!binding || !lower.parent) return;
    const lowerWorld = lower.getWorldQuaternion(new Quaternion());
    const direction = hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3())).normalize();
    const localAxis = direction.clone().applyQuaternion(lowerWorld.clone().invert());
    const delta = lowerWorld.clone().invert().multiply(desired).multiply(binding.wrist.clone().invert());
    const projection = new Vector3(delta.x, delta.y, delta.z).dot(localAxis);
    const turn = 2 * Math.atan2(projection, delta.w);
    const world = new Quaternion().setFromAxisAngle(direction, turn).multiply(lowerWorld);
    lower.quaternion.copy(lower.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    root.updateMatrixWorld(true);
  };
  /** Drive the released hand from stable rail-contact controls into a neutral wrist. */
  const relaxSocket = (upper: Object3D, lower: Object3D, hand: Object3D, socket: Object3D,
    goal: Vector3, pole: Vector3, endpoint: Vector3, endpointOrientation: Quaternion,
    railAxis: Vector3, fingerLocal: Vector3, weight: number) => {
    const binding = calibration.get(lower);
    if (!binding || !hand.parent || !upper.parent || !lower.parent) return;
    const saved = [upper, lower, hand].map(bone => bone.quaternion.clone());
    const endpointHand = endpointOrientation.clone();
    for (let pass = 0; pass < 4; pass++) {
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new Quaternion()).invert().multiply(endpointHand));
      root.updateMatrixWorld(true);
      const offset = socket.getWorldPosition(new Vector3()).sub(hand.getWorldPosition(new Vector3()));
      apply(upper, lower, hand, endpoint.clone().sub(offset), pole);
      alignWrist(lower, hand, endpointHand);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new Quaternion()).invert().multiply(endpointHand));
      root.updateMatrixWorld(true);
      if (pass < 3) {
        const desiredFinger = fingerLocal.clone().applyQuaternion(endpointOrientation);
        const forearm = hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3())).normalize();
        desiredFinger.addScaledVector(railAxis, -desiredFinger.dot(railAxis));
        forearm.addScaledVector(railAxis, -forearm.dot(railAxis));
        const turn = Math.atan2(railAxis.dot(desiredFinger.clone().cross(forearm)), desiredFinger.dot(forearm));
        endpointHand.copy(new Quaternion().setFromAxisAngle(railAxis, Math.max(-Math.PI / 3, Math.min(Math.PI / 3, turn))))
          .multiply(endpointOrientation);
      }
    }
    const lowerAtContact = lower.getWorldQuaternion(new Quaternion());
    const wristAtContact = lowerAtContact.clone().invert().multiply(endpointHand);
    const shoulderAt = upper.getWorldPosition(new Vector3()), elbowAt = lower.getWorldPosition(new Vector3());
    const socketAt = socket.getWorldPosition(new Vector3());
    const contactAxis = socketAt.clone().sub(shoulderAt).normalize();
    const contactPole = elbowAt.clone().sub(shoulderAt);
    contactPole.addScaledVector(contactAxis, -contactPole.dot(contactAxis)).normalize();
    const baseContactPole = pole.clone().addScaledVector(contactAxis, -pole.dot(contactAxis)).normalize();
    const elbowTurn = Math.atan2(contactAxis.dot(baseContactPole.clone().cross(contactPole)), baseContactPole.dot(contactPole));
    const localSocket = lower.worldToLocal(socketAt.clone()).multiply(lower.getWorldScale(new Vector3())).normalize();
    const contactNormal = elbowAt.clone().sub(shoulderAt).cross(socketAt.clone().sub(elbowAt)).normalize()
      .applyQuaternion(lowerAtContact.clone().invert());
    contactNormal.addScaledVector(localSocket, -contactNormal.dot(localSocket)).normalize();
    const nativeNormal = binding.normal.clone().addScaledVector(localSocket, -binding.normal.dot(localSocket)).normalize();
    const nativeReference = basis(localSocket, nativeNormal).invert();
    const contactReference = basis(localSocket, contactNormal).invert();
    const roll = contactReference.clone().multiply(nativeReference.clone().invert());
    let pronation = 2 * Math.atan2(roll.x, roll.w);
    while (pronation > Math.PI) pronation -= 2 * Math.PI;
    while (pronation < -Math.PI) pronation += 2 * Math.PI;
    [upper, lower, hand].forEach((bone, index) => bone.quaternion.copy(saved[index]!));
    root.updateMatrixWorld(true);
    const relative = binding.wrist.clone().slerp(wristAtContact, weight);
    const offset = hand.worldToLocal(socket.getWorldPosition(new Vector3()));
    offset.multiply(hand.getWorldScale(new Vector3()).divide(lower.getWorldScale(new Vector3()))).applyQuaternion(relative);
    const tip = lower.worldToLocal(hand.getWorldPosition(new Vector3())).add(offset);
    const tipDirection = tip.clone().multiply(lower.getWorldScale(new Vector3())).normalize();
    const refNormal = binding.normal.clone().addScaledVector(tipDirection, -binding.normal.dot(tipDirection)).normalize();
    const reference = basis(tipDirection, refNormal).invert()
      .premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pronation * weight));
    const socketAxis = goal.clone().sub(upper.getWorldPosition(new Vector3())).normalize();
    const freePole = pole.clone().addScaledVector(socketAxis, -pole.dot(socketAxis)).normalize()
      .applyAxisAngle(socketAxis, elbowTurn * weight);
    apply(upper, lower, hand, goal, freePole, tip, reference);
    const lowerWorld = lower.getWorldQuaternion(new Quaternion()), handWorld = lowerWorld.clone().multiply(relative);
    hand.quaternion.copy(hand.parent.getWorldQuaternion(new Quaternion()).invert().multiply(handWorld));
    root.updateMatrixWorld(true);
    const elbowWorld = lower.getWorldPosition(new Vector3());
    const upperDirection = elbowWorld.clone().sub(upper.getWorldPosition(new Vector3())).normalize();
    const actualNormal = upperDirection.clone().cross(hand.getWorldPosition(new Vector3()).sub(elbowWorld)).normalize();
    upper.quaternion.copy(upper.parent.getWorldQuaternion(new Quaternion()).invert()
      .multiply(basis(upperDirection, actualNormal).multiply(binding.upper)));
    root.updateMatrixWorld(true);
    lower.quaternion.copy(lower.parent.getWorldQuaternion(new Quaternion()).invert().multiply(lowerWorld));
    root.updateMatrixWorld(true);
    hand.quaternion.copy(hand.parent.getWorldQuaternion(new Quaternion()).invert().multiply(handWorld));
    root.updateMatrixWorld(true);
  };
  return { apply, alignWrist, relaxSocket };
};
