import { DMath } from "../../shared/math/deterministic-math";

/** Model-space targets shared by the visible two-arm pose and authoritative manual arrow origin. */
export const commanderBowHandTargets = (pitch: number, draw: number, guarding = false) => {
  const angle = Math.max(-Math.PI * .45, Math.min(Math.PI * .45, pitch));
  const rotate = (x: number, y: number, z: number): [number, number, number] =>
    [x, .86 + (y - .86) * DMath.cos(angle) + z * DMath.sin(angle),
      z * DMath.cos(angle) - (y - .86) * DMath.sin(angle)];
  const left = rotate(.12, .99, .26);
  if (guarding) return { left, right: rotate(.02, .9, .25), pitch: angle };
  return { left, right: rotate(.02 - .1 * draw, .93 + .04 * draw, .22 - .17 * draw), pitch: angle };
};
