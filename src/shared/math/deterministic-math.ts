/**
 * Deterministic math for the simulation path (D4.6). `Math.hypot`, `sin`, `cos`, `atan2`, `exp`, ... are not
 * required to be correctly rounded, and engines differ in the last bits: Firefox's hypot, WebKit's libm and even
 * two V8 versions (Node vs Chrome sin/cos) disagree on some inputs, which a replay then amplifies. These ports of
 * fdlibm (Sun Microsystems, freely redistributable) use only IEEE-754 + - * / and sqrt, which every engine rounds
 * the same way, so the server and every browser compute identical bits. Accuracy: under 1 ulp like fdlibm (tan
 * and the large-argument reduction are a little less exact, still deterministic).
 */

const words = new Float64Array(1);
const halves = new Int32Array(words.buffer);
/** Index of the high (sign/exponent) 32-bit word of a float64 on this platform. */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

const highWord = (x: number) => {
  words[0] = x;
  return halves[HI]!;
};
const lowWord = (x: number) => {
  words[0] = x;
  return halves[LO]!;
};
const fromWords = (high: number, low: number) => {
  halves[HI] = high;
  halves[LO] = low;
  return words[0]!;
};
const withHighWord = (x: number, high: number) => {
  words[0] = x;
  halves[HI] = high;
  return words[0]!;
};

/** sqrt is correctly rounded everywhere: the plain formula is deterministic (no overflow at game scales). */
const hypot = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);

const S1 = -0.16666666666666632, S2 = 0.00833333333332249, S3 = -0.0001984126982985795;
const S4 = 0.0000027557313707070068, S5 = -2.5050760253406863e-8, S6 = 1.58969099521155e-10;

/** |x| below this: the kernels' Taylor head alone (2^-27). */
const TINY = 7.450580596923828e-9;
/** |x| below this needs no reduction (high word 0x3fe921fc: just above pi/4). */
const PIO4_BOUND = fromWords(0x3fe921fc, 0);
const COS_SIMPLE = fromWords(0x3fd33333, 0), COS_FIXED_QX = fromWords(0x3fe90001, 0);

/** sin on [-pi/4, pi/4]; `tail` is the tail of the reduced argument. */
const kernelSin = (x: number, tail: number, hasTail: boolean) => {
  if (Math.abs(x) < TINY) return x;
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!hasTail) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * tail - v * r) - tail) - v * S1);
};

const C1 = 0.0416666666666666, C2 = -0.001388888888887411, C3 = 0.00002480158728947673;
const C4 = -2.7557314351390663e-7, C5 = 2.087572321298175e-9, C6 = -1.1359647557788195e-11;

/** cos on [-pi/4, pi/4]. */
const kernelCos = (x: number, tail: number) => {
  const ax = Math.abs(x);
  if (ax < TINY) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ax < COS_SIMPLE) return 1 - (0.5 * z - (z * r - x * tail));
  const qx = ax >= COS_FIXED_QX ? 0.28125 : fromWords((highWord(ax)) - 0x00200000, 0);
  const hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * tail));
};

const INV_PIO2 = 0.6366197723675814;
const PIO2_1 = 1.5707963267341256, PIO2_1T = 6.077100506506192e-11;
const PIO2_2 = 6.077100506303966e-11, PIO2_2T = 2.0222662487959506e-21;
const PIO2_3 = 2.0222662487111665e-21, PIO2_3T = 8.4784276603689e-32;
/** fdlibm refines when the head lost about 16 (then 49) bits to cancellation. */
const FIRST_REFINEMENT = 2 ** -16, SECOND_REFINEMENT = 2 ** -49;

/** The reduced argument of the last `reducePio2` (head, tail): x = n * pi/2 + head + tail. */
const reduced = { head: 0, tail: 0 };

/**
 * |x| (above pi/4) mod pi/2: fdlibm's medium-size reduction with its two refinements (which also serves larger
 * arguments deterministically). Returns n; the remainder is in `reduced`.
 */
const reducePio2 = (x: number) => {
  const t = Math.abs(x);
  const n = Math.trunc(t * INV_PIO2 + 0.5), fn = n;
  let r = t - fn * PIO2_1, w = fn * PIO2_1T;
  let head = r - w;
  if (Math.abs(head) < t * FIRST_REFINEMENT) {
    let previous = r;
    w = fn * PIO2_2; r = previous - w; w = fn * PIO2_2T - ((previous - r) - w); head = r - w;
    if (Math.abs(head) < t * SECOND_REFINEMENT) {
      previous = r;
      w = fn * PIO2_3; r = previous - w; w = fn * PIO2_3T - ((previous - r) - w); head = r - w;
    }
  }
  const tail = (r - head) - w;
  if (x < 0) {
    reduced.head = -head; reduced.tail = -tail;
    return -n;
  }
  reduced.head = head; reduced.tail = tail;
  return n;
};

const sin = (x: number) => {
  const ax = Math.abs(x);
  if (ax < PIO4_BOUND) return kernelSin(x, 0, false);
  if (!(ax < Infinity)) return NaN;
  const quadrant = reducePio2(x) & 3, { head, tail } = reduced;
  if (quadrant === 0) return kernelSin(head, tail, true);
  if (quadrant === 1) return kernelCos(head, tail);
  if (quadrant === 2) return -kernelSin(head, tail, true);
  return -kernelCos(head, tail);
};

const cos = (x: number) => {
  const ax = Math.abs(x);
  if (ax < PIO4_BOUND) return kernelCos(x, 0);
  if (!(ax < Infinity)) return NaN;
  const quadrant = reducePio2(x) & 3, { head, tail } = reduced;
  if (quadrant === 0) return kernelCos(head, tail);
  if (quadrant === 1) return -kernelSin(head, tail, true);
  if (quadrant === 2) return -kernelCos(head, tail);
  return kernelSin(head, tail, true);
};

/** tan as sin / cos of the same reduction (within ~2 ulp; deterministic). */
const tan = (x: number) => sin(x) / cos(x);

const ATAN_HI = [0.4636476090008061, 0.7853981633974483, 0.982793723247329,
  1.5707963267948966] as const;
const ATAN_LO = [2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17,
  6.123233995736766e-17] as const;
const AT = [0.3333333333333293, -0.19999999999876483, 0.14285714272503466,
  -0.11111110405462356, 0.09090887133436507, -0.0769187620504483, 0.06661073137387531,
  -0.058335701337905735, 0.049768779946159324, -0.036531572744216916,
  0.016285820115365782] as const;

/** |x| at or above this: atan is pi/2 (high word 0x44100000: 2^66); below ATAN_TINY: atan(x) = x (2^-29). */
const ATAN_HUGE = 2 ** 66, ATAN_TINY = 2 ** -29;

/** atan's argument reduction: the table entry and the reduced argument (-1: none). */
const atanReduction = (x: number, ax: number): [number, number] => {
  if (ax < 0.4375) return [-1, x];
  if (ax < 0.6875) return [0, (2 * ax - 1) / (2 + ax)];
  if (ax < 1.1875) return [1, (ax - 1) / (ax + 1)];
  if (ax < 2.4375) return [2, (ax - 1.5) / (1 + 1.5 * ax)];
  return [3, -1 / ax];
};

const atan = (x: number) => {
  const ax = Math.abs(x);
  if (ax >= ATAN_HUGE) return x > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  if (Number.isNaN(x) || ax < ATAN_TINY) return x;
  const [id, reducedX] = atanReduction(x, ax);
  const z = reducedX * reducedX, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return reducedX - reducedX * (s1 + s2);
  const result = ATAN_HI[id]! - ((reducedX * (s1 + s2) - ATAN_LO[id]!) - reducedX);
  return x < 0 ? -result : result;
};

const PI = Math.PI, PI_LO = 1.2246467991473532e-16;
const PI_O_2 = 1.5707963267948966, PI_O_4 = 0.7853981633974483;

/** atan2 of the special cases (zeros and infinities) by quadrant `m`; undefined for ordinary arguments. */
const atan2Special = (y: number, x: number, m: number) => {
  if (y === 0) return [y, y, PI, -PI][m]!;
  if (x === 0) return y < 0 ? -PI_O_2 : PI_O_2;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m]!;
    return [0, -0, PI, -PI][m]!;
  }
  if (y === Infinity || y === -Infinity) return y < 0 ? -PI_O_2 : PI_O_2;
  return undefined;
};

/** The sign bit, -0 included. */
const isNegative = (value: number) => value < 0 || Object.is(value, -0);
/** fdlibm's 60 binary orders of magnitude between y and x: the angle is then 0 or pi/2 at double precision. */
const ATAN2_SPREAD = 2 ** 60;

const atan2 = (y: number, x: number) => {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  const m = (isNegative(y) ? 1 : 0) | (isNegative(x) ? 2 : 0);
  const special = atan2Special(y, x, m);
  if (special !== undefined) return special;
  const ay = Math.abs(y), ax = Math.abs(x);
  let z: number;
  if (ay > ax * ATAN2_SPREAD) z = PI_O_2 + 0.5 * PI_LO;
  else if (x < 0 && ay * ATAN2_SPREAD < ax) z = 0;
  else z = atan(ay / ax);
  if (m === 0) return z;
  if (m === 1) return -z;
  if (m === 2) return PI - (z - PI_LO);
  return (z - PI_LO) - PI;
};

/** asin / acos through atan2 and sqrt (deterministic; within ~2 ulp). */
const asin = (x: number) => Math.abs(x) > 1 ? NaN : atan2(x, Math.sqrt((1 - x) * (1 + x)));
const acos = (x: number) => Math.abs(x) > 1 ? NaN : atan2(Math.sqrt((1 - x) * (1 + x)), x);

const LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10, INV_LN2 = 1.4426950408889634;
const P1 = 0.16666666666666602, P2 = -0.0027777777777015593, P3 = 0.00006613756321437934;
const P4 = -0.0000016533902205465252, P5 = 4.1381367970572385e-8;
const O_THRESHOLD = 709.782712893384, U_THRESHOLD = -745.1332191019411;
const TWO_M1000 = 9.332636185032189e-302;

/** exp's argument reduction: x = k ln2 + hi - lo. */
const expReduction = (x: number, ix: number, negative: boolean): [number, number, number] => {
  if (ix < 0x3ff0a2b2) return negative ? [-1, x + LN2_HI, -LN2_LO] : [1, x - LN2_HI, LN2_LO];
  const k = Math.trunc(INV_LN2 * x + (negative ? -0.5 : 0.5));
  return [k, x - k * LN2_HI, k * LN2_LO];
};

const exp = (x: number) => {
  const hx = highWord(x), ix = hx & 0x7fffffff, negative = hx < 0;
  if (ix >= 0x40862e42) {
    if (Number.isNaN(x)) return x;
    if (x === Infinity) return x;
    if (x === -Infinity) return 0;
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  if (ix < 0x3e300000) return 1 + x;
  let k = 0, hi = 0, lo = 0;
  if (ix > 0x3fd62e42) [k, hi, lo] = expReduction(x, ix, negative);
  const r = k === 0 ? x : hi - lo;
  const t = r * r, c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  if (k >= -1021) return withHighWord(y, highWord(y) + (k << 20));
  return withHighWord(y, highWord(y) + ((k + 1000) << 20)) * TWO_M1000;
};

const LG1 = 0.6666666666666735, LG2 = 0.3999999999940942, LG3 = 0.2857142874366239;
const LG4 = 0.22222198432149784, LG5 = 0.1818357216161805, LG6 = 0.15313837699209373;
const LG7 = 0.14798198605116586, TWO54 = 18014398509481984;

/** log near 1 (f = x - 1 tiny): the short series. */
const logNearOne = (f: number, k: number) => {
  if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
  const r = f * f * (0.5 - 0.3333333333333333 * f);
  return k === 0 ? f - r : k * LN2_HI - ((r - k * LN2_LO) - f);
};

const log = (input: number) => {
  let x = input, hx = highWord(x), k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lowWord(x)) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) return logNearOne(f, k);
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1, wide = ((hx - 0x6147a) | (0x6b851 - hx)) > 0;
  if (wide) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + r));
    return k * LN2_HI - ((hfsq - (s * (hfsq + r) + k * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - r);
  return k * LN2_HI - ((s * (f - r) - k * LN2_LO) - f);
};

/**
 * Engine-independent `Math` functions for every module the simulation runs (`DMath.sin(...)` where the code used
 * `Math.sin(...)`). Rendering keeps the native, faster `Math`.
 */
export const DMath = { acos, asin, atan, atan2, cos, exp, hypot, log, sin, sqrt: Math.sqrt, tan } as const;

/** Deterministic power for simulation/generation code; native `Math.pow` differs across engines. */
export const deterministicPow = (base: number, exponent: number) => {
  if (base <= 0) return 0;
  if (exponent === 0) return 1;
  return DMath.exp(exponent * DMath.log(base));
};
