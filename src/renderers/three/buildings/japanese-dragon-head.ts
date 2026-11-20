import { Vector3 } from "three";

import { type DragonStrip, SCALE_REPEAT } from "./japanese-dragon-atlas";
import type { CoilFrame } from "./japanese-dragon-geometry";
import {
  addBlade, addLoft, addOrb, addTaperedTube, type DragonMesh, type LoftRing, pathRings, UP
} from "./japanese-dragon-mesh";
import { addDragonMuzzle, jawLine } from "./japanese-dragon-muzzle";

/** Point in the head's frame, in head units: forward along the snout, up, and to the side. */
type HeadPoint = (forward: number, up: number, side?: number) => Vector3;

export interface Head { at: HeadPoint; side: Vector3; size: number; up: Vector3 }

/**
 * Belly band direction of the body + skull loft, from the coil's outward normal towards up: down
 * and in towards the column. The skull turns it to straight down (chin plates).
 */
export const BODY_BELLY_ANGLE = Math.PI * 1.3;
/** Frame turn that brings the belly band from BODY_BELLY_ANGLE to straight down. */
const CHIN_TURN = -Math.PI / 2 - BODY_BELLY_ANGLE + Math.PI * 2;
/** Scale repeat (v) on the skull: the neck's size shrinking to tiny scales on the snout. */
const NECK_SCALE_REPEAT = SCALE_REPEAT;
const SNOUT_SCALE_REPEAT = SCALE_REPEAT * .25;

/**
 * Head frame (reference dragon-7): the neck arches up from the coil and the head looks out from the
 * column, angled down and forward.
 */
export const createHeadFrame = (neck: CoilFrame, size: number): Head => {
  const forward = neck.normal.clone().multiplyScalar(.75).addScaledVector(UP, -.28)
    .addScaledVector(neck.tangent, .4).normalize();
  const up = UP.clone().addScaledVector(forward, -forward.dot(UP)).normalize();
  const side = new Vector3().crossVectors(forward, up);
  const base = neck.centre.clone().addScaledVector(neck.tangent, size * .5).addScaledVector(UP, size * .95);
  const at: HeadPoint = (f, u, s = 0) =>
    base.clone().addScaledVector(forward, f * size).addScaledVector(up, u * size).addScaledVector(side, s * size);
  return { at, side, size, up };
};

const scaled = (values: readonly number[], size: number) => values.map(value => value * size);

/** Skull profile (reference dragon-8): crown, brow, a stop, a short deep snout swelling at the nose. */
const SKULL = {
  f: [-.25, .55, 1.15, 1.65, 2.1, 2.45, 2.72], height: [.92, 1.02, .9, .66, .48, .5, .34],
  u: [.15, .36, .32, .18, .2, .23, .18], width: [.96, 1.08, .95, .66, .52, .57, .4]
} as const;
/** Minimal skull: its own rounder loft (more sides than the body) from a closed back of the head. */
const MINIMAL_SKULL = { back: [-.75, .12, .3] as const, rings: 8, sides: 10 } as const;

/** Turns a ring's cross-section by `angle` (from side towards up). */
const turnRing = (ring: LoftRing, angle: number): LoftRing => {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { ...ring, side: ring.side.clone().multiplyScalar(cos).addScaledVector(ring.up, sin),
    up: ring.up.clone().multiplyScalar(cos).addScaledVector(ring.side, -sin) };
};

/**
 * Rings continuing the body loft from the neck into the skull: the neck's radius and direction at
 * the joint, the cross-section turning so the chin plates face down, and v flowing on from the
 * body (`vStart`) with scales shrinking towards the snout. `tip` closes the snout. Minimal: the
 * neck ends inside the back of the head, the skull is its own rounder loft (addMinimalSkull).
 */
export const skullRings = (head: Head, neck: CoilFrame, vStart: number, detailed: boolean) => {
  const { at, size } = head, neckSize = neck.radius / size;
  const profile = detailed ? SKULL : { f: [-.25], height: [neckSize * 1.15], u: [.15], width: [neckSize * 1.15] };
  // The muscular neck: on from the coil, arching up behind the head, then into the crown.
  const points = [neck.centre, neck.centre.clone().addScaledVector(neck.tangent, size * .35), at(-1.05, -.35),
    ...profile.f.map((f, index) => at(f, profile.u[index]!))];
  const widths = scaled([neckSize, neckSize * 1.02, neckSize * 1.12, ...profile.width], size);
  const heights = scaled([neckSize, neckSize * 1.02, neckSize * 1.15, ...profile.height], size);
  const rings = pathRings(points, widths, heights, head.up, detailed ? 30 : 5, 1);
  let v = vStart;
  const flowing = rings.map((ring, index) => {
    const t = index / (rings.length - 1);
    if (index) v += ring.centre.distanceTo(rings[index - 1]!.centre) /
      (NECK_SCALE_REPEAT + (SNOUT_SCALE_REPEAT - NECK_SCALE_REPEAT) * Math.min(1, t * 1.4));
    return turnRing({ ...ring, v }, CHIN_TURN * Math.min(1, t * 3));
  });
  const tip = detailed ? at(SKULL.f.at(-1)! + .2, SKULL.u.at(-1)! - .02) : at(.35, .3);
  return { rings: flowing.slice(1), tip };
};

/**
 * Minimal skull: the High profile as one round loft, closed at the back of the head (round the
 * neck's end) and at the snout, chin plates facing down, scales shrinking towards the snout.
 */
const addMinimalSkull = (mesh: DragonMesh, { at, size, up }: Head) => {
  const [backF, backU, backSize] = MINIMAL_SKULL.back;
  const points = [at(backF, backU), ...SKULL.f.map((f, index) => at(f, SKULL.u[index]!))];
  const rings = pathRings(points, scaled([backSize, ...SKULL.width], size), scaled([backSize, ...SKULL.height], size),
    up, MINIMAL_SKULL.rings, (NECK_SCALE_REPEAT + SNOUT_SCALE_REPEAT) / 2);
  const back = at(backF - .12, backU);
  addLoft(mesh, [{ ...rings[0]!, centre: back, height: size * .01, width: size * .01 }, ...rings],
    { sides: MINIMAL_SKULL.sides, strip: "wrap", tip: at(SKULL.f.at(-1)! + .2, SKULL.u.at(-1)! - .02) });
};

/** The lower jaw dropped wide open in a roar, scaled with chin plates underneath. */
const addJaw = (mesh: DragonMesh, { at, size, up }: Head, detailed: boolean) => {
  const stations = [.3, 1, 1.7, 2.3];
  const jaw = pathRings(stations.map(f => at(f, jawLine(f))), scaled([.6, .5, .38, .24], size),
    scaled([.28, .23, .17, .12], size), up, detailed ? 14 : 4, SNOUT_SCALE_REPEAT);
  addLoft(mesh, jaw, { sides: detailed ? 14 : 6, strip: "wrap", tip: at(2.48, jawLine(2.4)) });
};

/** Heavy scaled brow ridge arching over each eye, with short pale spikes along it (High). */
const addBrows = (mesh: DragonMesh, { at, size, up }: Head, detailed: boolean) => {
  for (const s of [-1, 1]) {
    const rings = pathRings([at(.35, .85, s * .32), at(.85, 1.08, s * .62), at(1.3, .98, s * .72),
      at(1.65, .64, s * .54)], scaled([.22, .27, .22, .12], size), scaled([.2, .24, .18, .1], size), up, detailed ? 10 : 3,
      SNOUT_SCALE_REPEAT);
    addLoft(mesh, rings, { sides: detailed ? 10 : 4, strip: "wrap", tip: at(1.8, .48, s * .44) });
    if (!detailed) continue;
    for (const spike of [0, 1, 2]) {
      const root = at(.55 + spike * .35, 1.1 - spike * .04, s * (.5 + spike * .08));
      addTaperedTube(mesh, [root, at(.1 + spike * .3, 1.55 - spike * .12, s * (.75 + spike * .08))],
        scaled([.08, 0], size), 5, "ivory");
    }
  }
};

/**
 * Brown antler horns (reference dragon-7) rooted at the back of the skull, sweeping back with
 * forward-pointing tines on High.
 */
const addHorns = (mesh: DragonMesh, { at, size }: Head, detailed: boolean) => {
  for (const s of [-1, 1]) {
    addTaperedTube(mesh, [at(-.3, .8, s * .44), at(-.9, 1.35, s * .62), at(-1.8, 1.6, s * .72),
      at(-2.7, 1.45, s * .76), at(-3.3, 1, s * .76)], scaled([.3, .24, .17, .09, 0], size), detailed ? 9 : 5,
      "antler", detailed ? 14 : 5);
    if (!detailed) continue;
    addTaperedTube(mesh, [at(-1.3, 1.5, s * .68), at(-1.05, 1.9, s * .72), at(-.75, 2.05, s * .74)],
      scaled([.12, .08, 0], size), 6, "antler", 6);
    addTaperedTube(mesh, [at(-2.2, 1.58, s * .74), at(-2.1, 1.95, s * .8), at(-1.9, 2.1, s * .82)],
      scaled([.09, .06, 0], size), 6, "antler", 5);
  }
};

/** Amber iris under the brow with a vertical slit pupil. */
const addEye = (mesh: DragonMesh, { at, size }: Head, s: number, detailed = true) => {
  addOrb(mesh, at(1.02, .55, s * .82), size * .18, detailed ? 12 : 6, detailed ? 8 : 4, "amber");
  const middle = at(1.06, .55, s * .99);
  for (const end of [.13, -.13]) addTaperedTube(mesh, [middle, at(1.06, .55 + end, s * .97)], [size * .035, 0],
    detailed ? 5 : 3, "dark");
};

/** Eyes, flared scaled nostrils, white fangs, the red palate and tongue. */
const addFace = (mesh: DragonMesh, head: Head) => {
  const { at, size } = head;
  for (const s of [-1, 1]) {
    addEye(mesh, head, s);
    for (const tooth of [0, 1, 2, 3]) {
      const f = 2.45 - tooth * .32, length = tooth ? .2 : .44;
      addTaperedTube(mesh, [at(f, -.3, s * (.28 - tooth * .02)), at(f + .04, -.3 - length, s * .28)],
        scaled([.075 - tooth * .015, 0], size), 5, "ivory");
      const gum = jawLine(f - .25) + .2;
      addTaperedTube(mesh, [at(f - .25, gum, s * .22), at(f - .22, gum + length * .8, s * .23)],
        scaled([.06 - tooth * .012, 0], size), 5, "ivory");
    }
  }
};

/** The red palate under the upper jaw and the tongue curling up from the lower one. */
const addPalate = (mesh: DragonMesh, { at, size, up }: Head, detailed: boolean) => {
  addLoft(mesh, pathRings([at(.5, -.4), at(1.4, -.45), at(2.25, -.36)], scaled([.46, .4, .26], size),
    scaled([.09, .08, .06], size), up, detailed ? 6 : 3, .16), { sides: detailed ? 8 : 6, strip: "mouth" });
  addTaperedTube(mesh, [at(.8, jawLine(.8) + .1), at(1.4, jawLine(1.4) + .15), at(1.75, jawLine(1.75) + .2),
    at(2, jawLine(2) + .45)], scaled([.2, .16, .1, 0], size), detailed ? 6 : 3, "mouth", detailed ? 8 : 4);
};

/**
 * A pointed leaf-like spine (crest frills): a curved midline with a width that tapers to the tip,
 * spread along `across`, drawn double-faced.
 */
const addFrill = (mesh: DragonMesh, spine: readonly Vector3[], widths: readonly number[], across: Vector3,
  strip: DragonStrip) => {
  const left = spine.map((point, index) => point.clone().addScaledVector(across, -widths[index]! / 2));
  const right = spine.map((point, index) => point.clone().addScaledVector(across, widths[index]! / 2));
  // A narrow v band round the frill's vein: the gradient runs along u (root to tip).
  addBlade(mesh, left, right, strip, [.38, .62]);
};

interface CrestLayer { count: number; lift: number; out: number; reach: number; root: number; start: number }

/** Crest layers sweeping back from the brow (and lower ones from the cheeks): spine count and placement. */
const CREST_LAYERS: readonly CrestLayer[] = [
  { count: 7, lift: 1, out: .45, reach: 2.4, root: .75, start: 1 },
  { count: 6, lift: .45, out: .8, reach: 2.1, root: .45, start: .7 },
  { count: 5, lift: -.25, out: .95, reach: 1.8, root: .05, start: .35 }
];

/**
 * Crest of layered green spines (reference dragon-8): each layer fans back from the brow
 * or cheek, every spine a curved pointed frill with its flat side facing out.
 */
const addCrest = (mesh: DragonMesh, head: Head, layers: readonly CrestLayer[]) => {
  const { at, side, size, up } = head;
  layers.forEach((layer, layerIndex) => {
    for (const s of [-1, 1]) for (let spine = 0; spine < layer.count; spine++) {
      const fan = spine / (layer.count - 1), f = layer.start - fan * 1.6, u = layer.root - fan * .5;
      const root = at(f, u, s * (layer.out - fan * .1));
      const tip = at(f - layer.reach, u + layer.lift * (1 - fan * .6) + .3, s * (layer.out + .45));
      const mid = root.clone().lerp(tip, .5).addScaledVector(up, size * .25);
      const across = up.clone().multiplyScalar(.3).addScaledVector(side, s * .2).normalize();
      addFrill(mesh, [root, mid, tip], scaled([.34 - layerIndex * .04, .24, 0], size), across, "frill");
    }
  });
};

/**
 * Whiskers ("dragon mustache"): long strands from the upper lip beside the nostrils, thick at the
 * root and thin at the tip, drooping in an S-curve that swings out, back and forward again.
 * Minimal: the same drooping curve with eight samples and a three-sided cross-section.
 */
const addWhiskers = (mesh: DragonMesh, { at, size }: Head, detailed: boolean) => {
  for (const s of [-1, 1]) {
    const strand = [at(2.5, .05, s * .36), at(2.95, -.05, s * .78), at(2.95, -.6, s * 1.2), at(2.45, -1.2, s * 1.5),
      at(2.65, -1.9, s * 1.7), at(2.2, -2.6, s * 1.82), at(2.45, -3.1, s * 1.78)];
    if (!detailed) {
      addTaperedTube(mesh, strand, scaled([.1, .085, .07, .055, .04, .022, 0], size), 3, "dark", 6);
      continue;
    }
    addTaperedTube(mesh, strand, scaled([.1, .085, .07, .055, .04, .022, 0], size), 6, "dark", 22);
  }
};

/** Short green beard and barbels hanging under the jaw. */
const addBeard = (mesh: DragonMesh, { at, size }: Head) => {
  for (const s of [-1, 0, 1]) {
    const f = 1.2 - Math.abs(s) * .3, chin = jawLine(f) - .2;
    addTaperedTube(mesh, [at(f, chin, s * .2), at(f - .2, chin - .45, s * .32), at(f - .1, chin - .9, s * .36)],
      scaled([.09, .06, 0], size), 5, "frill", 6);
  }
};

/** Minimal crest: the High crest's upper two layers, fewer frills per side. */
const MINIMAL_CREST_LAYERS: readonly CrestLayer[] = [
  { ...CREST_LAYERS[0]!, count: 4 }, { ...CREST_LAYERS[1]!, count: 3 }
];

/**
 * Minimal head on its own round skull: amber eyes under the brows, swept antlers, drooping
 * whiskers, the open jaw with fangs and palate, the muzzle and a two-layer frill crest.
 */
const addMinimalHead = (mesh: DragonMesh, head: Head) => {
  addMinimalSkull(mesh, head);
  const { at, size } = head;
  for (const side of [-1, 1]) {
    addEye(mesh, head, side, false);
    addTaperedTube(mesh, [at(2.4, -.3, side * .28), at(2.44, -.78, side * .28)], scaled([.07, 0], size), 3, "ivory");
    const gum = jawLine(1.9) + .2;
    addTaperedTube(mesh, [at(1.9, gum, side * .2), at(1.93, gum + .3, side * .21)], scaled([.06, 0], size), 3,
      "ivory");
  }
  addPalate(mesh, head, false);
  addDragonMuzzle(mesh, head, false);
  addCrest(mesh, head, MINIMAL_CREST_LAYERS);
};

/**
 * Ryu head (references dragon-7 and dragon-8): roaring open jaw, brown antler horns, drooping
 * whiskers, brow ridges, slit-pupil eyes, fangs and red palate. High grows the skull from the body
 * loft and adds brow spikes, flared nostrils, extra teeth, the third crest layer and the beard.
 */
export const addDragonHead = (mesh: DragonMesh, head: Head, detailed: boolean) => {
  addJaw(mesh, head, detailed);
  addHorns(mesh, head, detailed);
  addWhiskers(mesh, head, detailed);
  addBrows(mesh, head, detailed);
  if (!detailed) return addMinimalHead(mesh, head);
  addFace(mesh, head);
  addPalate(mesh, head, true);
  addDragonMuzzle(mesh, head, true);
  addCrest(mesh, head, CREST_LAYERS);
  addBeard(mesh, head);
};
