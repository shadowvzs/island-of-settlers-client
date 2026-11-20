import { type MeleePose, track } from "./worker-melee-tracks";

/** Alternate the leading axe each attack; the other guards outside the torso, never on its haft. */
export const dualTomahawkPose = (progress: number | null, variant: number, defending: boolean): MeleePose => {
  const p = progress ?? 0, leadLeft = variant % 2 !== 0;
  const sample = (rest: number, wind: number, hit: number, follow: number) =>
    track(p, [[0, rest], [.4, wind], [.78, hit], [.9, follow], [1, rest]]);
  const active = [sample(.2, .25, .1, .12), sample(.71, 1.03, .8, .65), sample(.22, -.025, .4, .33)];
  const guardY = defending && progress === null ? .91 : .72;
  const pitch = sample(.5, -.45, 1.7, 2.1);
  const rightHand: [number, number, number] = leadLeft ? [-.23, guardY, .19] : [-active[0]!, active[1]!, active[2]!];
  const leftHand: [number, number, number] = leadLeft ? [active[0]!, active[1]!, active[2]!] : [.23, guardY, .19];
  const direction = leadLeft ? -1 : 1;
  return {
    bend: sample(0, -.08, .2, .25), leftHand, leftPitch: leadLeft ? pitch : .5,
    leftYaw: .15, pitch: leadLeft ? .5 : pitch, rightHand, shield: false, sweep: false,
    twist: direction * sample(0, -.2, .25, .3), yaw: -.15,
    body: { drop: .035, hipYaw: direction * sample(-.1, -.3, .1, .15), lift: 0,
      shift: sample(0, -.02, .07, .05), stance: { back: .1, front: .1, width: .1 }, step: 0 }
  };
};
