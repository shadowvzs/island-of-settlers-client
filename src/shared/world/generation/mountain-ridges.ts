import { createRidgedNoise, type Noise2,smoothstep } from "../noise";
import type { Random } from "../rng";
import { randomBetween } from "../rng";

/**
 * Massif anatomy: a main crest along an axis with 2-3 peaks and the saddles (cols) between them,
 * spurs running down to the lowland (mostly on the gentle back side), cirques at the heads of the
 * valleys between the spurs (where the springs sit), a steep cliff side and a gentle back slope.
 */
export interface Ridge {
  /** Crest height per point. */
  crest: number[];
  points: [number, number][];
  /** Mean rise per cell of the left / right flank (concave profile: steeper near the crest). */
  slopes: [number, number];
}

/** A bowl capping the ground at a valley head: a flat floor and a steep headwall. */
export interface Cirque {
  floor: number;
  /** Height the bowl wall reaches at its radius. */
  rim: number;
  radius: number;
  x: number;
  z: number;
}

export interface MassifShape {
  cirques: Cirque[];
  ridges: Ridge[];
}

export interface MassifSeed {
  /** Main crest direction (radians). */
  axis: number;
  height: number;
  /** Direction (radians) towards more land: the gentle back slope usually faces it. */
  inland: number;
  /** Size factor (1 from the reference map up; smaller on small maps). */
  size: number;
  x: number;
  z: number;
}

const RIDGE_STEP = 1.5;
/** Mean flank slopes (rise per cell): the cliff side and the gentle back side. */
const STEEP_SLOPE = { max: 0.85, min: 0.72 } as const;
const GENTLE_SLOPE = { max: 0.44, min: 0.34 } as const;
/** Saddle depth: the crest midway between two peaks keeps about 1 - drop / 4 of the peak. */
const SADDLE_DROP = 1.25;
/**
 * Spurs on the gentle side (long, their flanks are the valley walls) and buttresses on the cliff
 * side (short, with gullies between them): count range, length (share of the flank run) and how
 * much steeper their flanks are than the main flank of their side.
 */
const SPURS = { count: [3, 5], flank: 1.6, length: [0.95, 1.25] } as const;
const BUTTRESSES = { count: [2, 4], flank: 1.25, length: [0.5, 0.8] } as const;
type SpurKind = typeof SPURS | typeof BUTTRESSES;
/** Massifs whose long back slope faces inland (the rest turn their cliff side inland). */
const INLAND_BACK_SHARE = 0.8;

/** Smooth maximum: rounded saddles and junctions instead of creases. */
export const smoothMax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
};

interface Peak {
  height: number;
  t: number;
}

const createPeaks = (height: number, random: Random): Peak[] => {
  const count = 2 + Math.floor(random() * 2);
  const highest = Math.floor(random() * count);
  return Array.from({ length: count }, (_, index) => ({
    height: index === highest ? height : height * randomBetween(random, 0.7, 0.9),
    t: (index + 0.5 + randomBetween(random, -0.15, 0.15)) / count
  }));
};

/** Crest height along the main ridge (t 0..1): peaks, saddles between them, falling ends. */
const getMainCrest = (peaks: Peak[], t: number) => {
  let crest = 0;
  for (const peak of peaks) {
    const offset = (t - peak.t) * peaks.length;
    const height = peak.height * (1 - SADDLE_DROP * offset * offset);
    crest = crest === 0 ? height : smoothMax(crest, height, peak.height * 0.15);
  }
  const ends = 0.35 + 0.65 * smoothstep(0, 0.2, Math.min(t, 1 - t));
  return Math.max(crest * ends, peaks[0]!.height * 0.25);
};

/** Ridged noise along the crest: jagged sub-peaks and notches, a few percent of the height. */
const getCrestRoughness = (noise: Noise2, arc: number, offset: number) =>
  1 + (noise(arc * 0.16, offset) - 0.45) * 0.14;

/** Points of a gently bending line from `start` along `angle`. */
const traceLine = (
  start: [number, number],
  angle: number,
  steps: number,
  random: Random,
  bend: number
) => {
  const points: [number, number][] = [start];
  let heading = angle;
  let turn = (random() - 0.5) * bend;
  for (let step = 1; step <= steps; step += 1) {
    turn += (random() - 0.5) * bend * 0.5;
    heading += turn;
    const [px, pz] = points[step - 1]!;
    points.push([px + Math.cos(heading) * RIDGE_STEP, pz + Math.sin(heading) * RIDGE_STEP]);
  }
  return points;
};

/** Side (+1 left normal, -1 right normal) of the gentle slope: mostly the inland one. */
const chooseGentleSide = (seed: MassifSeed, random: Random): 1 | -1 => {
  const inlandSide = Math.sin(seed.inland - seed.axis) >= 0 ? 1 : -1;
  return random() < INLAND_BACK_SHARE ? inlandSide : (-inlandSide as 1 | -1);
};

interface MainCrest {
  /** Normal of the gentle side (left normal of the axis when +1, right when -1). */
  gentleSide: 1 | -1;
  peaks: Peak[];
  ridge: Ridge;
}

const createMainCrest = (seed: MassifSeed, noise: Noise2, random: Random): MainCrest => {
  const length = randomBetween(random, 38, 56) * seed.size;
  const steps = Math.max(4, Math.round(length / RIDGE_STEP));
  const start: [number, number] = [
    seed.x - (Math.cos(seed.axis) * length) / 2,
    seed.z - (Math.sin(seed.axis) * length) / 2
  ];
  const points = traceLine(start, seed.axis, steps, random, 0.05);
  const peaks = createPeaks(seed.height, random);
  const offset = random() * 100;
  const crest = points.map((_, step) => {
    const t = step / steps;
    return getMainCrest(peaks, t) * getCrestRoughness(noise, step * RIDGE_STEP, offset);
  });
  const steep = randomBetween(random, STEEP_SLOPE.min, STEEP_SLOPE.max);
  const gentle = randomBetween(random, GENTLE_SLOPE.min, GENTLE_SLOPE.max);
  const gentleSide = chooseGentleSide(seed, random);
  const slopes: [number, number] = gentleSide === 1 ? [gentle, steep] : [steep, gentle];
  return { gentleSide, peaks, ridge: { crest, points, slopes } };
};

/** Crest point and direction of a ridge at t (0..1). */
const getRidgeFrame = (ridge: Ridge, t: number) => {
  const last = ridge.points.length - 1;
  const step = Math.min(last - 1, Math.max(0, Math.round(t * last)));
  const [ax, az] = ridge.points[step]!;
  const [bx, bz] = ridge.points[step + 1]!;
  return { angle: Math.atan2(bz - az, bx - ax), crest: ridge.crest[step]!, x: ax, z: az };
};

/** Mean slope of the main flank on a side (+1 left normal, -1 right normal). */
const getSideSlope = (main: Ridge, side: 1 | -1) => main.slopes[side === 1 ? 0 : 1];

/** One spur: leaves the crest, its own crest falling with a shoulder to the lowland. */
const createSpur = (main: MainCrest, plan: SpurPlan, random: Random): Ridge => {
  const { kind, side, t } = plan;
  const frame = getRidgeFrame(main.ridge, t);
  const sideSlope = getSideSlope(main.ridge, side);
  const start = frame.crest * 0.95;
  const length = (start / sideSlope) * randomBetween(random, kind.length[0], kind.length[1]);
  const steps = Math.max(3, Math.round(length / RIDGE_STEP));
  const outward = (t - 0.5) * 1.1;
  const angle = frame.angle + side * (Math.PI / 2 - outward) + randomBetween(random, -0.3, 0.3);
  const points = traceLine([frame.x, frame.z], angle, steps, random, 0.08);
  const crest = points.map((_, step) => start * Math.pow(1 - step / steps, 0.75) + 0.3);
  const flank = sideSlope * kind.flank;
  return { crest, points, slopes: [flank, flank] };
};

interface SpurPlan {
  kind: SpurKind;
  side: 1 | -1;
  t: number;
}

/** Spurs (or buttresses) of one kind, spread along the crest in order of t. */
const planSpurs = (kind: SpurKind, side: 1 | -1, random: Random): SpurPlan[] => {
  const count = kind.count[0] + Math.floor(random() * (kind.count[1] - kind.count[0] + 1));
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5 + randomBetween(random, -0.25, 0.25)) / count;
    return { kind, side, t: Math.min(0.95, Math.max(0.05, t)) };
  });
};

/** Cirques at the valley heads between neighbouring gentle side spurs, below the crest. */
const createCirques = (main: MainCrest, gentle: SpurPlan[], size: number, random: Random) => {
  const cirques: Cirque[] = [];
  for (let index = 1; index < gentle.length; index += 1) {
    const frame = getRidgeFrame(main.ridge, (gentle[index - 1]!.t + gentle[index]!.t) / 2);
    const radius = randomBetween(random, 6, 8) * size;
    const normal = frame.angle + (main.gentleSide * Math.PI) / 2;
    const out = radius * 0.9;
    cirques.push({
      floor: frame.crest * randomBetween(random, 0.45, 0.55),
      radius,
      rim: frame.crest * 1.2,
      x: frame.x + Math.cos(normal) * out,
      z: frame.z + Math.sin(normal) * out
    });
  }
  return cirques;
};

/** The full massif: main crest, spurs and cirques. */
export const createMassifShape = (seed: MassifSeed, noiseSeed: number, random: Random) => {
  const noise = createRidgedNoise(noiseSeed, 3);
  const main = createMainCrest(seed, noise, random);
  const spurs = planSpurs(SPURS, main.gentleSide, random);
  const buttresses = planSpurs(BUTTRESSES, -main.gentleSide as 1 | -1, random);
  const ridges = [...spurs, ...buttresses].map((plan) => createSpur(main, plan, random));
  const cirques = createCirques(main, spurs, seed.size, random);
  return { cirques, ridges: [main.ridge, ...ridges] } satisfies MassifShape;
};
