import { lerp3 } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, NO_UV, normalize, type Vec3, type VertexStyle } from "../mesh-builder";
import { add, fromAngles, scale } from "../tree-parts";

/**
 * Water lily cluster (original procedural model): notched round pads of mixed sizes, curled
 * a little at the rim, floating in a loose group; two variants carry an open flower (white,
 * pale pink) with two rings of cupped petals around a golden centre.
 */

/** Variants: pads only (three layouts), a white flower, a pale pink flower. */
export const LILY_VARIANT_COUNT = 5;
const FIRST_FLOWER_VARIANT = 3;
/**
 * The whole cluster drifts as one piece with the wind on the water (constant bend weight):
 * the instance moves evenly; nothing bends like a stem.
 */
const LILY_DRIFT = 0.12;
const FLOATING = { flutter: 0, path: 1 } as const;
const PAD_SIDES = 16;
/** Half angle of the pad's slit (radians). */
const NOTCH = 0.16;
const CLUSTER_RADIUS = 0.3;
const PAD_RADIUS = [0.06, 0.13] as const;

const PAD_GREENS = {
  bronze: [0.42, 0.25, 0.14],
  dark: [0.12, 0.25, 0.08],
  base: [0.19, 0.36, 0.11],
  light: [0.32, 0.5, 0.16]
} as const satisfies Record<string, Vec3>;

const FLOWER_COLORS = {
  heart: [0.93, 0.72, 0.18],
  pink: [0.97, 0.76, 0.82],
  pinkTip: [0.92, 0.55, 0.66],
  white: [0.97, 0.96, 0.92],
  whiteBase: [0.86, 0.9, 0.74]
} as const satisfies Record<string, Vec3>;

interface Pad {
  /** Upturned rim height (share of the radius). */
  curl: number;
  /** Small height step per pad: overlapping pads never z-fight. */
  lift: number;
  radius: number;
  turn: number;
  x: number;
  z: number;
}


const constant = (color: Vec3): VertexStyle => ({ color: () => color, flutter: 0 });

/** Pads of the cluster, rejection sampled so they touch and overlap only a little. */
const layoutPads = (random: Random, count: number) => {
  const pads: Pad[] = [];
  for (let attempt = 0; attempt < count * 12 && pads.length < count; attempt += 1) {
    const radius = PAD_RADIUS[0] + random() * (PAD_RADIUS[1] - PAD_RADIUS[0]);
    const angle = random() * Math.PI * 2;
    const distance = pads.length === 0 ? random() * 0.05 : Math.sqrt(random()) * CLUSTER_RADIUS;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const overlaps = pads.some(
      (pad) => Math.hypot(pad.x - x, pad.z - z) < (pad.radius + radius) * 0.82
    );
    if (overlaps) continue;
    const curl = 0.04 + random() * 0.12;
    pads.push({ curl, lift: pads.length * 0.002, radius, turn: random() * Math.PI * 2, x, z });
  }
  return pads;
};

/** Pad colour: darker veins towards the rim, a bronze young pad now and then. */
const getPadPalette = (random: Random) => {
  const tone = random();
  const base = tone < 0.25 ? PAD_GREENS.dark : PAD_GREENS.base;
  const young = random() < 0.25 ? 0.45 : 0.08;
  return {
    centre: lerp3(base, PAD_GREENS.light, 0.45),
    rim: lerp3(base, PAD_GREENS.bronze, young)
  };
};

/** Rim height at a share of the radius: flat middle, upturned edge. */
const getCurlHeight = (pad: Pad, share: number) => pad.curl * pad.radius * share ** 3;

/** One notched pad: a fan from the centre to a mid ring and a wavy, upturned rim. */
const addPad = (builder: MeshBuilder, pad: Pad, random: Random) => {
  const palette = getPadPalette(random);
  const centre = builder.addVertex(
    [pad.x, pad.lift, pad.z],
    [0, 1, 0],
    constant(palette.centre),
    NO_UV,
    FLOATING
  );
  const rings = [0.55, 1];
  const first = builder.vertexCount;
  for (let side = 0; side <= PAD_SIDES; side += 1) {
    const angle = pad.turn + NOTCH + (side / PAD_SIDES) * (Math.PI * 2 - NOTCH * 2);
    const wave = 1 + (random() - 0.5) * 0.08;
    for (const share of rings) {
      const reach = pad.radius * share * (share === 1 ? wave : 1);
      const direction: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
      const position: Vec3 = [
        pad.x + direction[0] * reach,
        pad.lift + getCurlHeight(pad, share),
        pad.z + direction[2] * reach
      ];
      const tilt = 3 * pad.curl * share * share;
      const normal = normalize([-direction[0] * tilt, 1, -direction[2] * tilt]);
      const color = lerp3(palette.centre, palette.rim, share * (0.8 + random() * 0.2));
      builder.addVertex(position, normal, constant(color), NO_UV, FLOATING);
    }
  }
  for (let side = 0; side < PAD_SIDES; side += 1) {
    const inner = first + side * 2;
    builder.addTriangle(centre, inner + 2, inner);
    builder.addTriangle(inner, inner + 2, inner + 1);
    builder.addTriangle(inner + 1, inner + 2, inner + 3);
  }
};

interface PetalRing {
  count: number;
  /** Elevation of the petals (radians above the water). */
  elevation: number;
  length: number;
  turn: number;
  width: number;
}

/** A cupped petal: base, two shoulders, a lowered midrib and the tip (four triangles). */
const addPetal = (
  builder: MeshBuilder,
  base: Vec3,
  azimuth: number,
  ring: PetalRing,
  colors: { base: Vec3; tip: Vec3 }
) => {
  const along = fromAngles(azimuth, ring.elevation);
  const side: Vec3 = [-Math.sin(azimuth), 0, Math.cos(azimuth)];
  const up = fromAngles(azimuth, ring.elevation + Math.PI / 2);
  const point = (share: number, offset: number, sink: number) =>
    add(add(add(base, scale(along, ring.length * share)), scale(side, offset)), scale(up, -sink));
  const shoulder = ring.width * 0.5;
  const style = (color: Vec3) => constant(color);
  const middle = lerp3(colors.base, colors.tip, 0.5);
  const root = builder.addVertex(base, up, style(colors.base), NO_UV, FLOATING);
  const left = builder.addVertex(point(0.5, -shoulder, 0), up, style(middle), NO_UV, FLOATING);
  const right = builder.addVertex(point(0.5, shoulder, 0), up, style(middle), NO_UV, FLOATING);
  const rib = builder.addVertex(
    point(0.5, 0, ring.width * 0.25),
    up,
    style(middle),
    NO_UV,
    FLOATING
  );
  const tip = builder.addVertex(point(1, 0, 0), up, style(colors.tip), NO_UV, FLOATING);
  builder.addTriangle(root, rib, left);
  builder.addTriangle(root, right, rib);
  builder.addTriangle(left, rib, tip);
  builder.addTriangle(rib, right, tip);
};

/** Golden stamen crown: a small raised fan in the middle of the flower. */
const addHeart = (builder: MeshBuilder, base: Vec3, radius: number) => {
  const middle = builder.addVertex(
    add(base, [0, radius * 0.9, 0]),
    [0, 1, 0],
    constant(FLOWER_COLORS.heart),
    NO_UV,
    FLOATING
  );
  const first = builder.vertexCount;
  const sides = 7;
  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const position = add(base, [Math.cos(angle) * radius, radius * 0.3, Math.sin(angle) * radius]);
    const color = lerp3(FLOWER_COLORS.heart, [0.75, 0.5, 0.12], 0.4);
    builder.addVertex(
      position,
      normalize([Math.cos(angle), 1, Math.sin(angle)]),
      constant(color),
      NO_UV,
      FLOATING
    );
  }
  for (let side = 0; side < sides; side += 1) {
    builder.addTriangle(middle, first + ((side + 1) % sides), first + side);
  }
};

/** Open flower: a flat outer ring, a steeper inner ring offset half a petal, the heart. */
const addFlower = (builder: MeshBuilder, base: Vec3, pink: boolean, random: Random) => {
  const colors = pink
    ? { base: FLOWER_COLORS.pink, tip: FLOWER_COLORS.pinkTip }
    : { base: FLOWER_COLORS.whiteBase, tip: FLOWER_COLORS.white };
  const size = 0.75 + random() * 0.25;
  const turn = random() * Math.PI;
  const rings: PetalRing[] = [
    { count: 9, elevation: 0.35, length: 0.075 * size, turn, width: 0.034 * size },
    { count: 8, elevation: 0.85, length: 0.06 * size, turn: turn + 0.35, width: 0.028 * size }
  ];
  for (const ring of rings) {
    for (let petal = 0; petal < ring.count; petal += 1) {
      const azimuth = ring.turn + (petal / ring.count) * Math.PI * 2 + (random() - 0.5) * 0.15;
      addPetal(builder, base, azimuth, ring, colors);
    }
  }
  addHeart(builder, add(base, [0, 0.008, 0]), 0.014 * size);
};

/** Water lily prop mesh (one unit = one cell, base at the water surface). */
export const createWaterLily = (random: Random, variant: number) => {
  const builder = new MeshBuilder();
  const pads = layoutPads(random, 4 + Math.floor(random() * 4));
  for (const pad of pads) addPad(builder, pad, random);
  if (variant >= FIRST_FLOWER_VARIANT) {
    const host = pads[Math.floor(random() * pads.length)]!;
    const flowerBase: Vec3 = [host.x + host.radius * 0.3, pads.length * 0.002 + 0.004, host.z];
    addFlower(builder, flowerBase, variant > FIRST_FLOWER_VARIANT, random);
  }
  return builder.finish({ flex: LILY_DRIFT });
};
