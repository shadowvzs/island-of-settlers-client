import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";

/**
 * Japanese decoration props as recipe parts (all stage 3, mostly vertex-coloured paint so each
 * building adds no extra materials): paper lanterns and cedar balls that swing on High, bamboo
 * clumps, fences and banner poles, wall fans, shimenawa ropes and coiled dragons.
 */
const CORD: Point3 = [.16, .11, .07];
const PAPER: Point3 = [.97, .96, .92];
const STRAW_ROPE: Point3 = [1.35, 1.2, .82];
/** Body thickness of a coiled dragon relative to its column's radius (with a floor for thin posts). */
const DRAGON_BODY = .6;

const part = (shape: BuildingPart["shape"], surface: BuildingPart["surface"], position: Point3, size: Point3,
  extra: Partial<BuildingPart> = {}): BuildingPart => ({ position, shape, size, stage: 3, surface, ...extra });

/** Rotation turning the +y axis of a cylinder-like part onto the direction from `from` to `to`. */
const axisRotation = (from: Point3, to: Point3): Point3 => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = DMath.hypot(dx, dy, dz) || 1;
  return [DMath.acos(Math.max(-1, Math.min(1, dy / length))), DMath.atan2(dx, dz), 0];
};

const midpoint = (from: Point3, to: Point3): Point3 =>
  [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];

const distance = (from: Point3, to: Point3) => DMath.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);

/** A round member (cord, rope, bamboo) from one point to another. */
const member = (shape: BuildingPart["shape"], surface: BuildingPart["surface"], from: Point3, to: Point3,
  thickness: number, extra: Partial<BuildingPart> = {}) =>
  part(shape, surface, midpoint(from, to), [thickness, distance(from, to), thickness],
    { rotation: axisRotation(from, to), ...extra });

/** Lantern size: a chochin a little shorter than a settler's head-to-waist. */
const LANTERN_SIZE: Point3 = [.12, .17, .12];

/**
 * Chochin hanging from `hang` on a cord `drop` long: the cord's top reaches into the eave it
 * hangs from. Everything swings about the hang point on High.
 */
export const paperLantern = (hang: Point3, drop: number, scale = 1): BuildingPart[] => {
  const height = LANTERN_SIZE[1] * scale, swayPivot = hang;
  const bottom: Point3 = [hang[0], hang[1] - drop, hang[2]];
  return [
    member("cord", "paint", [hang[0], hang[1] + .015, hang[2]], [bottom[0], bottom[1] - .01, bottom[2]], .008,
      { swayPivot, tint: CORD }),
    part("paper-lantern", "paint", [bottom[0], bottom[1] - height / 2, bottom[2]],
      [LANTERN_SIZE[0] * scale, height, LANTERN_SIZE[2] * scale], { swayPivot })
  ];
};

/** Height below the hang point taken by a lantern on a cord of `drop`. */
export const lanternReach = (drop: number, scale = 1) => drop + LANTERN_SIZE[1] * scale;

/** Sugidama: the cedar ball a sake brewer hangs out when the new brew is ready, on a short cord. */
export const sugidama = (hang: Point3, drop: number, diameter = .2): BuildingPart[] => {
  const centre: Point3 = [hang[0], hang[1] - drop - diameter / 2, hang[2]], swayPivot = hang;
  return [
    member("cord", "paint", [hang[0], hang[1] + .015, hang[2]], [hang[0], centre[1] + diameter * .3, hang[2]], .01,
      { swayPivot, tint: CORD }),
    part("sphere", "leaf", centre, [diameter, diameter * .96, diameter], { radialSegments: 8, swayPivot,
      tint: [.62, .78, .5] })
  ];
};

/** One bamboo culm standing on the ground at `base`, leaning a little (radians about x and z). */
const culm = (base: Point3, height: number, diameter: number, lean: [number, number]): BuildingPart => {
  const [ax, az] = lean, sink = .02;
  const direction: Point3 = [-DMath.sin(az) * DMath.cos(ax), DMath.cos(az) * DMath.cos(ax), DMath.sin(ax)];
  const centre: Point3 = [base[0] + direction[0] * (height / 2 - sink), base[1] + direction[1] * (height / 2 - sink),
    base[2] + direction[2] * (height / 2 - sink)];
  return part("bamboo-culm", "paint", centre, [diameter, height, diameter], { rotation: [ax, 0, az] });
};

/** Top of a culm built by `culm` (the leaf sprays hang from it). */
const culmTop = (stalk: BuildingPart): Point3 => {
  const [ax, , az] = stalk.rotation ?? [0, 0, 0], half = stalk.size[1] / 2;
  return [stalk.position[0] - DMath.sin(az) * DMath.cos(ax) * half, stalk.position[1] + DMath.cos(az) * DMath.cos(ax) * half,
    stalk.position[2] + DMath.sin(ax) * half];
};

/** Leaf spray hanging from a twig point (its top centre) just inside a culm. */
const leafSpray = (twig: Point3, spread: number, droop: number): BuildingPart =>
  part("bamboo-leaves", "leaf", [twig[0], twig[1] - droop / 2 + .01, twig[2]], [spread, droop, spread]);

/** Culms of a clump: offset from the clump centre, height, diameter and lean. */
const CLUMP: ReadonlyArray<{ at: [number, number]; height: number; diameter: number; lean: [number, number] }> = [
  { at: [0, 0], diameter: .05, height: 1.3, lean: [.03, -.04] },
  { at: [.07, .04], diameter: .042, height: 1.05, lean: [.06, .1] },
  { at: [-.06, .05], diameter: .045, height: 1.18, lean: [.08, -.12] },
  { at: [.02, -.07], diameter: .036, height: .82, lean: [-.1, .05] }
];

/** Radius of ground a bamboo clump takes, leaves overhanging excluded. */
export const BAMBOO_CLUMP_RADIUS = .12;

/**
 * Bamboo stand: four culms of different heights (three on Minimal) from one root, each crowned
 * with a drooping spray of narrow leaves, the tallest with a second spray lower down (High).
 * `scale` shortens the clump under low eaves.
 */
export const bambooClump = (centre: Point3, detailed: boolean, scale = 1): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  CLUMP.slice(0, detailed ? 4 : 3).forEach(({ at, diameter, height, lean }, index) => {
    const stalk = culm([centre[0] + at[0], centre[1], centre[2] + at[1]], height * scale, diameter, lean);
    parts.push(stalk);
    const top = culmTop(stalk);
    // Smaller sprays on a short clump.
    const spread = (detailed ? .44 : .4) * (.5 + scale / 2);
    parts.push(leafSpray([top[0], top[1] - .02, top[2]], spread, .22 * (.5 + scale / 2)));
    if (detailed && index === 0)
      parts.push(leafSpray(midpoint(top, [centre[0], centre[1] + height * scale * .45, centre[2]]), spread * .77, .18));
  });
  return parts;
};

/**
 * Yotsume-gaki: a low bamboo fence from `from` to `to` (ground points): posts at most 0.32 apart,
 * two rails on their outer side, lashed with black palm-fibre cord (High).
 */
export const bambooFence = (from: Point3, to: Point3, outward: Point3, detailed: boolean): BuildingPart[] => {
  const length = distance(from, to), posts = Math.max(2, Math.ceil(length / .32) + 1), parts: BuildingPart[] = [];
  const postHeight = .44, postDiameter = .034, railDiameter = .024, offset = (postDiameter + railDiameter) / 2;
  const at = (t: number, y: number, out = 0): Point3 => [from[0] + (to[0] - from[0]) * t + outward[0] * out, y,
    from[2] + (to[2] - from[2]) * t + outward[2] * out];
  for (let post = 0; post < posts; post++) {
    const t = post / (posts - 1);
    parts.push(part("bamboo-culm", "paint", at(t, postHeight / 2 - .02), [postDiameter, postHeight + .04, postDiameter]));
  }
  for (const y of [.18, .36]) parts.push(member("bamboo-culm", "paint", at(-.02, y, offset), at(1.02, y, offset),
    railDiameter));
  // Black palm-fibre lashings where the upper rail crosses each post.
  if (detailed) for (let post = 0; post < posts; post++)
    parts.push(part("box", "dark", at(post / (posts - 1), .36, offset * .5), [.026, .034, .026]));
  return parts;
};

/**
 * Nobori: a tall banner on a bamboo pole with a cross pole at the top; `side` (+1/-1, along x)
 * is where the cloth hangs, `facing` the banner's outward axis sign along z. High adds a crest.
 */
export const nobori = (base: Point3, side: number, detailed: boolean, color: Point3 = [.16, .22, .5]): BuildingPart[] => {
  const height = 1.32, width = .17, clothHeight = .6, pole = .032;
  const top = base[1] + height, clothX = base[0] + side * (pole / 2 + width / 2);
  const parts = [
    part("bamboo-culm", "paint", [base[0], base[1] + height / 2 - .02, base[2]], [pole, height + .04, pole]),
    member("bamboo-culm", "paint", [base[0] - side * .01, top - .05, base[2]], [clothX + side * (width / 2 + .02),
      top - .05, base[2]], .02),
    part("box", "paint", [clothX, top - .06 - clothHeight / 2, base[2]], [width, clothHeight, .008], { tint: color })
  ];
  if (!detailed) return parts;
  // White crest band and a painted disc near the top of both faces.
  parts.push(part("box", "paint", [clothX, top - .14, base[2]], [width + .002, .05, .01], { tint: PAPER }));
  for (const face of [-1, 1]) parts.push(part("paint-ellipse", "paint", [clothX, top - .3, base[2] + face * .0055],
    [.1, .1, .002], { rotation: [0, face > 0 ? 0 : Math.PI, 0], tint: PAPER }));
  return parts;
};

/**
 * Folding fan on a wall: `hub` on the wall face (the fan opens upward from it), `yaw` turns its
 * front (+z) outward, radius in recipe units.
 */
export const wallFan = (hub: Point3, yaw: number, radius: number): BuildingPart =>
  part("folding-fan", "paint", hub, [radius, radius, radius], { rotation: [0, yaw, 0] });

/**
 * Shimenawa: a thick twisted rice-straw rope sagging between two points, fattest in the middle,
 * with zigzag shide paper streamers and straw tassels hanging from it (High).
 */
export const shimenawa = (from: Point3, to: Point3, sag: number, thickness: number, detailed: boolean): BuildingPart[] => {
  const segments = detailed ? 6 : 3, parts: BuildingPart[] = [];
  const point = (t: number): Point3 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t -
    sag * 4 * t * (1 - t), from[2] + (to[2] - from[2]) * t];
  for (let segment = 0; segment < segments; segment++) {
    const t0 = segment / segments, t1 = (segment + 1) / segments, girth = 1 + .45 * DMath.sin(Math.PI * (t0 + t1) / 2);
    parts.push(member("cylinder", "rope", point(t0 - .01), point(t1 + .01), thickness * girth,
      { radialSegments: detailed ? 8 : 5, tint: STRAW_ROPE }));
  }
  if (!detailed) return parts;
  for (const t of [.2, .5, .8]) {
    const knot = point(t), hang = knot[1] - thickness * .55;
    // Three zigzag steps of folded paper.
    for (let step = 0; step < 3; step++) parts.push(part("box", "paint",
      [knot[0] + (step % 2 ? .012 : -.012), hang - .02 - step * .032, knot[2] + thickness * .3], [.03, .034, .004],
      { tint: PAPER }));
  }
  for (const t of [.35, .65]) {
    const knot = point(t);
    parts.push(part("cylinder", "straw", [knot[0], knot[1] - thickness * .5 - .025, knot[2]], [.022, .06, .022],
      { radialSegments: 5 }));
  }
  return parts;
};

/**
 * Ryu coiled round a vertical column (centre x/z, radius, from `bottom` to `top`), its head at
 * the top looking along `yaw` (0: +z). Drawn with its own lacquer-and-gold-leaf atlas material.
 */
export const coiledDragon = (column: { x: number; z: number; radius: number }, bottom: number, top: number,
  yaw: number): BuildingPart => {
  const body = Math.max(.024, column.radius * DRAGON_BODY);
  return part("dragon-coil", "paint", [column.x, (bottom + top) / 2, column.z],
    [2 * (column.radius + body * .85), top - bottom, 2 * body], { rotation: [0, yaw, 0] });
};
