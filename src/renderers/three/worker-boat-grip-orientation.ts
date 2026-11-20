import { Quaternion, Vector3 } from "three";

/** A grasp can roll on the gunwale; a released hand can relax its wrist. */
export const createBoatGripOrientation = () => {
  const history = new Map<string, { phase: number; value: number; previous?: number; window: number }>();
  return (base: Quaternion, forwardLocal: Vector3, forearm: Vector3, axis: Vector3,
    sign: number, phase: number, mode: number, free: number) => {
    const finger = forwardLocal.clone().applyQuaternion(base);
    const a = finger.clone().addScaledVector(axis, -finger.dot(axis));
    const b = forearm.clone().addScaledVector(axis, -forearm.dot(axis));
    let angle = a.lengthSq() > 1e-8 && b.lengthSq() > 1e-8
      ? Math.atan2(axis.dot(a.clone().cross(b)), a.dot(b)) : 0;
    const key = `${mode}:${sign}`, old = history.get(key);
    let state = old;
    if (!state || Math.abs(phase - state.phase) > .1) state = { phase, value: 0, window: Math.PI * 2 };
    else if (phase !== state.phase) state = { phase, value: state.value, previous: state.value,
      window: Math.max(.05, Math.abs(phase - state.phase) * 1.2 * Math.PI * 10 / 3) };
    while (angle - state.value > Math.PI) angle -= Math.PI * 2;
    while (angle - state.value < -Math.PI) angle += Math.PI * 2;
    angle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, angle));
    if (state.previous !== undefined) angle = Math.max(state.previous - state.window, Math.min(state.previous + state.window, angle));
    state.value = angle; history.set(key, state);
    const result = new Quaternion().setFromAxisAngle(axis, angle * (1 - free)).multiply(base);

    return result;
  };
};
