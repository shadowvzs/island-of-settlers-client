import { smoothstep } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, type PropMesh, type Vec3 } from "../mesh-builder";
import {
  addShellSurface,
  compose,
  finishStill,
  mixColor,
  type Placement,
  rotateX,
  rotateY,
  type ShellSurface,
  SHELL_FAMILY,
  sinkSurfaces,
  toShellUv
} from "./shell-surface";

/**
 * Coiled shells: one tube along a logarithmic spiral around the y axis (apex up), every turn
 * `growth` times larger than the one before, dropping from the apex as it grows. Garden snail
 * shells are globular with a low spire, whelks and conches have a tall spire, elongated whorls,
 * a drawn-out siphonal canal and shoulder knobs. Whorl lines, bands and mottling come from the
 * shell shader (spiral family).
 */

/** Shader patterns of the spiral family (three-shell-shading.ts). */
export const SPIRAL_PATTERN = { banded: 0, corded: 2, flamed: 3, mottled: 1, orangeBands: 4, spotted: 5 } as const;

export interface SpiralForm {
  /** Lower half of the cross-section stretched by this factor (siphonal canal), 1 for none. */
  canal: number;
  /** Spiral cord relief (share of the tube radius). */
  cords: number;
  /** Cross-section height / width. */
  elongation: number;
  growth: number;
  /** Shoulder knob relief and knobs per turn. */
  knobs: number;
  nodes: number;
  /** Coil radius and tube radius at the aperture; spire height (all in aperture units). */
  coil: number;
  spire: number;
  tube: number;
  turns: number;
}

export const GARDEN_SNAIL: SpiralForm = {
  canal: 1, coil: 0.52, cords: 0, elongation: 0.92, growth: 2.2, knobs: 0, nodes: 0, spire: 0.85,
  tube: 0.5, turns: 3.4
};

export const WHELK: SpiralForm = {
  canal: 1.6, coil: 0.38, cords: 0.035, elongation: 1.35, growth: 1.62, knobs: 0.1, nodes: 9,
  spire: 2.4, tube: 0.44, turns: 5
};

/** Smooth silhouettes on High: steps along each whorl and around the tube. */
const STEPS_PER_TURN = 12;
const AROUND = 18;

/**
 * Spire height actually used: at most the height at which each whorl still rests on the one
 * before it (no corkscrew gaps between whorls).
 */
const getSpire = (form: SpiralForm) => {
  const shrink = 1 / form.growth;
  return Math.min(form.spire, 0.85 * form.tube * form.elongation * (1 + shrink) / (1 - shrink));
};

/** Local point at u (0 apex .. 1 aperture) and v (around the tube, 0 = outer periphery). */
export const getSpiralPoint = (form: SpiralForm, u: number, v: number): Vec3 => {
  const turn = (u - 1) * form.turns;
  const angle = turn * Math.PI * 2;
  const scale = Math.pow(form.growth, turn);
  const around = v * Math.PI * 2;
  const up = Math.sin(around);
  const stretch = up < 0 ? form.elongation * form.canal : form.elongation;
  const shoulder = Math.exp(-((around - 0.9) ** 2) / 0.12) * Math.max(0, Math.cos(angle * form.nodes)) ** 2;
  const flare = 1 + 0.22 * smoothstep(0.94, 1, u);
  const radius = form.tube * scale * flare * (1 + form.knobs * shoulder + form.cords * Math.cos(around * 14));
  const outward = form.coil * scale + Math.cos(around) * radius;
  return [
    Math.cos(angle) * outward,
    getSpire(form) * (1 - scale) + up * stretch * radius,
    Math.sin(angle) * outward
  ];
};

/** Tube centre (the normals face away from it). */
const getSpiralCentre = (form: SpiralForm, u: number): Vec3 => {
  const turn = (u - 1) * form.turns;
  const angle = turn * Math.PI * 2;
  const scale = Math.pow(form.growth, turn);
  return [Math.cos(angle) * form.coil * scale, getSpire(form) * (1 - scale), Math.sin(angle) * form.coil * scale];
};

export interface SpiralOptions {
  form: SpiralForm;
  /** Aperture lip colour. */
  lip: Vec3;
  pattern: number;
  /** Placement into the prop (tilt) applied before sinking. */
  place: Placement;
  /** Shell width (cells) at the aperture whorl. */
  size: number;
  tone: Vec3;
  /** Part of the coil (fragments): u range and around range. */
  window?: { aroundFrom: number; aroundTo: number; from: number; to: number };
}

const FULL_COIL = { aroundFrom: 0, aroundTo: 1, from: 0, to: 1 };

export const getSpiralSurface = (options: SpiralOptions): ShellSurface => {
  const { form, lip, pattern, place, tone } = options;
  const window = options.window ?? FULL_COIL;
  const unit = options.size / (2 * (form.coil + form.tube));
  const toU = (u: number) => window.from + (window.to - window.from) * u;
  const toV = (v: number) => window.aroundFrom + (window.aroundTo - window.aroundFrom) * v;
  const scaled = ([x, y, z]: Vec3): Vec3 => place([x * unit, y * unit, z * unit]);
  const turnsShown = (window.to - window.from) * form.turns;
  return {
    colorAt: (u) => mixColor(tone, lip, smoothstep(0.97, 1, toU(u))),
    columns: Math.max(4, Math.round(turnsShown * STEPS_PER_TURN)),
    insideAt: (u) => scaled(getSpiralCentre(form, toU(u))),
    pointAt: (u, v) => scaled(getSpiralPoint(form, toU(u), toV(v))),
    rows: Math.max(3, Math.round(AROUND * (window.aroundTo - window.aroundFrom))),
    uvAt: (u, v) => toShellUv(SHELL_FAMILY.spiral, toV(v), toU(u) * form.turns, pattern)
  };
};

interface SpiralLook {
  lip: Vec3;
  pattern: number;
  tone: Vec3;
}

/** Garden snails: yellow banded with a dark lip, pink banded with a white lip, brown mottled. */
const SNAIL_LOOKS: SpiralLook[] = [
  { lip: [0.32, 0.2, 0.14], pattern: SPIRAL_PATTERN.banded, tone: [0.96, 0.82, 0.36] },
  { lip: [0.95, 0.92, 0.86], pattern: SPIRAL_PATTERN.banded, tone: [0.93, 0.7, 0.6] },
  { lip: [0.92, 0.88, 0.8], pattern: SPIRAL_PATTERN.mottled, tone: [0.74, 0.54, 0.3] }
];

/** Beach sea snails: shape, look and width range (cells) per variant. */
interface SeaSnail {
  form: SpiralForm;
  look: SpiralLook;
  size: [number, number];
  /** Relative pick weight (rare kinds lower). */
  weight: number;
}

const TURRET: SpiralForm = {
  canal: 1.1, coil: 0.3, cords: 0.05, elongation: 1.1, growth: 1.38, knobs: 0, nodes: 0, spire: 3.4,
  tube: 0.36, turns: 7
};
const TOP_SHELL: SpiralForm = {
  canal: 0.7, coil: 0.5, cords: 0.03, elongation: 0.75, growth: 1.85, knobs: 0, nodes: 0, spire: 1.7,
  tube: 0.45, turns: 4.5
};
const MUREX: SpiralForm = {
  canal: 2.1, coil: 0.4, cords: 0.02, elongation: 1.2, growth: 1.9, knobs: 0.22, nodes: 7, spire: 1.4,
  tube: 0.46, turns: 4
};
const OLIVE: SpiralForm = {
  canal: 1.3, coil: 0.22, cords: 0, elongation: 2.1, growth: 2.6, knobs: 0, nodes: 0, spire: 0.7,
  tube: 0.48, turns: 3.2
};
const PERIWINKLE: SpiralForm = {
  canal: 1, coil: 0.42, cords: 0.02, elongation: 1.05, growth: 2.1, knobs: 0, nodes: 0, spire: 1.15,
  tube: 0.52, turns: 3.6
};

/** White whelk: big smooth body whorl, short corded spire (the owner's beach reference pose). */
const WHITE_WHELK: SpiralForm = {
  canal: 1.5, coil: 0.3, cords: 0.04, elongation: 1.25, growth: 2.4, knobs: 0, nodes: 0, spire: 1.3,
  tube: 0.5, turns: 4
};
/** Moon snail: globular, glossy, very low spire. */
const MOON_SNAIL: SpiralForm = {
  canal: 1, coil: 0.48, cords: 0, elongation: 0.9, growth: 2.8, knobs: 0, nodes: 0, spire: 0.55,
  tube: 0.55, turns: 3
};
/** Cowrie-like egg: the body whorl wraps the tiny spire. */
const COWRIE: SpiralForm = {
  canal: 1.2, coil: 0.12, cords: 0, elongation: 1.9, growth: 5, knobs: 0, nodes: 0, spire: 0.25,
  tube: 0.6, turns: 2
};
/** Spider conch: rare, large, heavy shoulder fingers. */
const SPIDER_CONCH: SpiralForm = {
  canal: 2.3, coil: 0.42, cords: 0.02, elongation: 1.3, growth: 2.2, knobs: 0.5, nodes: 6, spire: 1.5,
  tube: 0.5, turns: 4
};
/** Small banded land-sea snail. */
const SMALL_BANDED: SpiralForm = { ...GARDEN_SNAIL, spire: 1, turns: 3.6 };

const PINK_LIP: Vec3 = [1, 0.62, 0.68];
const WHITE_LIP: Vec3 = [1, 0.97, 0.94];

/**
 * Cartoon-bright sea snails that stand out from sand and grass: knobbed murex white with orange
 * bands, flamed orange whelk-conch, slim coral turret, purple top shell, yellow-orange banded olive,
 * pink mottled periwinkle, white whelk, green turban, red-white striped top shell, orange-brown
 * moon snail, white cowrie with brown spots, rare yellow-white spider conch, small white snails
 * with brown bands. Mixed sizes.
 */
const SEA_SNAILS: SeaSnail[] = [
  { form: MUREX, look: { lip: PINK_LIP, pattern: SPIRAL_PATTERN.orangeBands, tone: [1, 0.97, 0.93] },
    size: [0.13, 0.16], weight: 1 },
  { form: WHELK, look: { lip: PINK_LIP, pattern: SPIRAL_PATTERN.flamed, tone: [1, 0.6, 0.2] },
    size: [0.14, 0.17], weight: 1 },
  { form: TURRET, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.corded, tone: [0.95, 0.36, 0.3] },
    size: [0.1, 0.12], weight: 1 },
  { form: TOP_SHELL, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.flamed, tone: [0.7, 0.42, 0.9] },
    size: [0.14, 0.17], weight: 1 },
  { form: OLIVE, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.banded, tone: [1, 0.76, 0.18] },
    size: [0.11, 0.13], weight: 1 },
  { form: PERIWINKLE, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.mottled, tone: [1, 0.55, 0.68] },
    size: [0.13, 0.16], weight: 1 },
  { form: WHITE_WHELK, look: { lip: PINK_LIP, pattern: SPIRAL_PATTERN.corded, tone: [1, 0.98, 0.95] },
    size: [0.15, 0.19], weight: 1 },
  { form: TOP_SHELL, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.mottled, tone: [0.5, 0.82, 0.48] },
    size: [0.12, 0.15], weight: 0.8 },
  { form: TOP_SHELL, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.orangeBands, tone: [1, 0.96, 0.95] },
    size: [0.11, 0.14], weight: 0.8 },
  { form: MOON_SNAIL, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.banded, tone: [0.96, 0.62, 0.34] },
    size: [0.13, 0.16], weight: 0.8 },
  { form: COWRIE, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.spotted, tone: [1, 0.97, 0.92] },
    size: [0.1, 0.13], weight: 0.6 },
  { form: SPIDER_CONCH, look: { lip: PINK_LIP, pattern: SPIRAL_PATTERN.flamed, tone: [1, 0.92, 0.6] },
    size: [0.2, 0.24], weight: 0.25 },
  { form: SMALL_BANDED, look: { lip: WHITE_LIP, pattern: SPIRAL_PATTERN.banded, tone: [1, 0.97, 0.92] },
    size: [0.09, 0.11], weight: 1 }
];

/** Pick weights per sea-snail variant (shore-details): rare kinds lie less often. */
export const SEA_SNAIL_WEIGHTS = SEA_SNAILS.map(({ weight }) => weight);
export const SEA_SNAIL_VARIANT_COUNT = SEA_SNAILS.length;
const createCoiledShell = (look: SpiralLook, form: SpiralForm, size: number, place: Placement) => {
  const builder = new MeshBuilder();
  const surface = getSpiralSurface({ ...look, form, place, size });
  const [sunk] = sinkSurfaces([surface], 0);
  addShellSurface(builder, sunk!, size * 0.18);
  return finishStill(builder);
};

/**
 * Lying on its side with the aperture facing down or down-sideways (the stable rest of an empty
 * shell): rolled a little around its own axis, then the axis tipped over by `tilt`.
 */
const lieOnSide = (random: Random, tilt: number) => compose(rotateY((random() - 0.5) * 1.2), rotateX(tilt));

/** Empty garden snail shell on a grassy bank, 0.21-0.27 cells wide (about twice the first set). */
export const createSnailShell = (random: Random, variant: number): PropMesh =>
  createCoiledShell(SNAIL_LOOKS[variant % SNAIL_LOOKS.length]!, GARDEN_SNAIL, 0.21 + random() * 0.06,
    lieOnSide(random, 1.1 + random() * 0.5));

/** Sea snail shell on the beach (whelk, conch, turret, top shell, olive, periwinkle). */
export const createSeaSnailShell = (random: Random, variant: number): PropMesh => {
  const { form, look, size } = SEA_SNAILS[variant % SEA_SNAILS.length]!;
  const width = size[0] + random() * (size[1] - size[0]);
  return createCoiledShell(look, form, width, lieOnSide(random, 1.45 + random() * 0.25));
};
