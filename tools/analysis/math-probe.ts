import { DMath } from "../../src/shared/math/deterministic-math";

/**
 * Cross-engine math probe (D4.6): the Math functions the simulation calls, evaluated on inputs shaped like the
 * game's (tile distances, headings, rates), natively and through the deterministic `DMath`. Runs in Node and in a
 * browser page; the results are exact float64 bits.
 */
type MathFunctions = Pick<typeof Math, keyof typeof DMath>;

const SAMPLES = 20_000;

/** mulberry32: the same inputs in every engine (integer math only). */
const createInputs = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

type Evaluate = (math: MathFunctions, random: () => number) => number;

/** Tile coordinates with fractions, headings in radians, unit vectors and production-like exponents. */
const EVALUATORS: Readonly<Record<string, Evaluate>> = {
  acos: (math, random) => math.acos(random() * 2 - 1),
  asin: (math, random) => math.asin(random() * 2 - 1),
  atan: (math, random) => math.atan((random() - .5) * 100),
  atan2: (math, random) => math.atan2((random() - .5) * 1200, (random() - .5) * 1200),
  cos: (math, random) => math.cos((random() - .5) * 8 * Math.PI),
  exp: (math, random) => math.exp((random() - .5) * 40),
  hypot: (math, random) => math.hypot((random() - .5) * 1200, (random() - .5) * 1200),
  log: (math, random) => math.log(random() * 1e6 + 1e-9),
  sin: (math, random) => math.sin((random() - .5) * 8 * Math.PI),
  tan: (math, random) => math.tan((random() - .5) * 3)
};
/** Measured identical so far; kept in the probe to notice a change (native only). */
const NATIVE_ONLY: Readonly<Record<string, (random: () => number) => number>> = {
  cbrt: random => Math.cbrt(random() * 1000),
  pow: random => Math.pow(random() * 2, (random() - .5) * 8),
  power: random => (random() * 3) ** 1.6,
  sqrt: random => Math.sqrt(random() * 1e6)
};

const toHex = (values: Float64Array) =>
  Array.from(new Uint8Array(values.buffer), byte => byte.toString(16).padStart(2, "0")).join("");

const sample = (seed: number, evaluate: (random: () => number) => number) => {
  const random = createInputs(seed), values = new Float64Array(SAMPLES);
  for (let index = 0; index < SAMPLES; index++) values[index] = evaluate(random);
  return toHex(values);
};

/** Each probed function's results as float64 bits: `native.<name>` and `deterministic.<name>`. */
export const runMathProbe = (): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [index, [name, evaluate]] of Object.entries(EVALUATORS).entries()) {
    result[`native.${name}`] = sample(index + 1, random => evaluate(Math, random));
    result[`deterministic.${name}`] = sample(index + 1, random => evaluate(DMath, random));
  }
  for (const [index, [name, evaluate]] of Object.entries(NATIVE_ONLY).entries())
    result[`native.${name}`] = sample(100 + index, evaluate);
  return result;
};
