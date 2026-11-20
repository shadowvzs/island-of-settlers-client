import {
  CanvasTexture, Color, MeshPhysicalMaterial, MeshStandardMaterial, type MeshStandardMaterialParameters,
RepeatWrapping} from "three";

import { lerp3, scale3 } from "../../../shared/world/noise";
import { BELLY_PLATES, DRAGON_ATLAS, type DragonStrip, SCALE_ROWS, SCALES_AROUND } from "./japanese-dragon-atlas";
import { albedoTexture, createAtlasPainter, fractalNoise, normalTexture } from "./nubian-paint-common";

type Rgb = readonly [number, number, number];

/** One painted texel: sRGB colour, relief height (0…1), roughness and glow (0…1, eyes and pearl). */
interface DragonTexel { colour: Rgb; glow?: number; height: number; rough: number }

/** How far (in scale rows) a scale's rounded free edge overlaps the row behind it. */
const OVERLAP = .45;
/** Width (in scale rows) of the dark outline along each scale's free edge. */
const RIM = .09;
/** Rich green scales (references dragon-6…8): light centres, deep green bases, near-black edges. */
const SCALE_CENTRE: Rgb = [76, 132, 46];
const SCALE_BASE: Rgb = [22, 62, 26];
const SCALE_EDGE: Rgb = [8, 24, 10];


/** Scale row and its centre-relative position across (-1…1) for a column of the staggered grid. */
const scaleColumn = (gx: number, row: number) => {
  const shifted = gx - (row % 2 ? .5 : 0);
  return (shifted - Math.floor(shifted)) * 2 - 1;
};

/** The scale's tail (free) edge: rounded, lowest at its centre line. */
const tailEdge = (row: number, across: number) => row - OVERLAP * Math.sqrt(Math.max(0, 1 - across * across));

/**
 * Overlapping scales: each row's rounded free edge (towards the tail) lies over the row behind it
 * with a dark outline; the scale is lightest in its centre, deepens towards its base under the next
 * row and towards its sides, and the scale it overlaps is shadowed just below the edge.
 */
const scaleTexel = (x: number, y: number): DragonTexel => {
  const gx = x * SCALES_AROUND, gy = y * SCALE_ROWS, row = Math.floor(gy);
  const nextAcross = scaleColumn(gx, row + 1), nextEdge = tailEdge(row + 1, nextAcross);
  const onNext = gy >= nextEdge;
  const across = onNext ? nextAcross : scaleColumn(gx, row);
  const fromEdge = gy - (onNext ? nextEdge : tailEdge(row, across));
  const depth = Math.min(1, fromEdge / (1 + OVERLAP));
  const shadow = onNext ? 1 : 1 - .5 * Math.max(0, 1 - (nextEdge - gy) / .2);
  const keel = .08 * (1 - Math.abs(across));
  const lip = Math.max(0, .06 - fromEdge) * 4;
  const height = .3 + .5 * Math.pow(1 - depth, .7) + keel - lip;
  if (fromEdge < RIM) return { colour: SCALE_EDGE, height, rough: .6 };
  const centre = Math.max(0, 1 - Math.hypot(across * .9, (depth - .35) * 2.2));
  const varied = .9 + .16 * fractalNoise(x * 5, y * 5, 11);
  // Darker along the top of the back (x 0.5), lighter down the flanks towards the belly.
  const flank = .72 + .4 * Math.abs(x * 2 - 1);
  const colour = scale3(lerp3(SCALE_BASE, SCALE_CENTRE, centre), varied * shadow * flank);
  return { colour, height, rough: .26 + .3 * depth + .1 * (1 - centre) };
};

/** Golden-ochre belly plates, each overlapping the one behind it, with dark seams and rounded sides. */
const bellyTexel = (x: number, y: number): DragonTexel => {
  const plate = y * BELLY_PLATES - Math.floor(y * BELLY_PLATES), side = Math.abs(x * 2 - 1);
  const seam = Math.max(0, 1 - plate / .06) + Math.max(0, 1 - (1 - plate) / .04);
  const shading = (1 - .55 * seam) * (1 - .3 * side * side);
  const colour = scale3(lerp3([226, 142, 48], [150, 82, 24], Math.pow(plate, .8)), shading);
  return { colour, height: .35 + .45 * (1 - plate) - .2 * side * side, rough: .32 + .2 * plate };
};

/** Flame tongues: deep orange at the root (v 0), streaked, yellow towards the tips (v 1). */
const flameTexel = (x: number, y: number): DragonTexel => {
  const streak = .5 + .5 * Math.cos(x * Math.PI * 2 * 7 + y * 3);
  const colour = scale3(lerp3([214, 74, 18], [252, 186, 58], Math.pow(y, .8)), .82 + .18 * streak);
  return { colour, height: .4 + .25 * streak, rough: .35 };
};

/** Crest frill: deep green root to pale green tip along x, a raised paler vein down the middle. */
const frillTexel = (x: number, y: number): DragonTexel => {
  const vein = Math.max(0, 1 - Math.abs(y - .5) / .08);
  const colour = lerp3(lerp3([18, 58, 22], [92, 140, 58], Math.pow(x, 1.2)), [126, 160, 92], vein * .5);
  return { colour, height: .45 + .2 * vein, rough: .35 };
};

/** Amber eye: a bright core fading to deep orange at the rim, softly lit. */
const amberTexel = (x: number): DragonTexel =>
  ({ colour: lerp3([255, 150, 24], [168, 48, 4], Math.abs(x * 2 - 1)), glow: .4, height: .5, rough: .12 });

/** Pale ivory-grey horn: growth ridges along v, greyer at the root and paler at the tip. */
const ivoryTexel = (_x: number, y: number): DragonTexel => {
  const ridge = .5 + .5 * Math.sin(y * Math.PI * 2 * 9);
  return { colour: scale3(lerp3([168, 166, 150], [240, 234, 214], y), .88 + .12 * ridge), height: .4 + .2 * ridge,
    rough: .4 };
};

/** Brown antler: growth ridges along v, dark at the root and pale towards the tip. */
const antlerTexel = (x: number, y: number): DragonTexel => {
  const ridge = .5 + .5 * Math.sin(y * Math.PI * 2 * 11 + x * 3), grain = fractalNoise(x * 8, y * 30, 5);
  return { colour: scale3(lerp3([92, 62, 38], [206, 180, 136], y), .8 + .14 * ridge + .1 * grain),
    height: .4 + .25 * ridge, rough: .55 };
};

/** Mouth: red gums shaded darker at the edges (x) with soft folds along v. */
const mouthTexel = (x: number, y: number): DragonTexel => {
  const edge = Math.abs(x * 2 - 1), fold = Math.sin(y * Math.PI * 2 * 4) ** 2;
  return { colour: scale3(lerp3([214, 66, 56], [96, 14, 14], edge), .8 + .2 * fold), height: .45 + .1 * fold, rough: .2 };
};

const pearlTexel = (_x: number, y: number): DragonTexel => {
  const sheen = .5 + .5 * Math.sin(y * Math.PI * 2);
  return { colour: lerp3([246, 226, 234], [222, 234, 248], sheen), glow: .25, height: .5, rough: .14 };
};

const STRIP_PAINTERS: Record<Exclude<DragonStrip, "wrap">, (x: number, y: number) => DragonTexel> = {
  amber: amberTexel,
  belly: bellyTexel,
  antler: antlerTexel,
  dark: () => ({ colour: [16, 30, 16], height: .5, rough: .4 }),
  flame: flameTexel,
  frill: frillTexel,
  ivory: ivoryTexel,
  mouth: mouthTexel,
  pearl: pearlTexel,
  scales: scaleTexel
};
/** Strips in atlas order (by u), so the first strip ending after u is the one u falls in. */
type StripPainter = [Exclude<DragonStrip, "wrap">, (x: number, y: number) => DragonTexel];
const STRIPS = (Object.entries(STRIP_PAINTERS) as StripPainter[])
  .sort(([a], [b]) => DRAGON_ATLAS[a].u0 - DRAGON_ATLAS[b].u0);

/** Texel at atlas (u, v): the strip it falls in, painted in that strip's own 0…1 coordinates. */
const paintTexel = (u: number, v: number) => {
  const [strip, paint] = STRIPS.find(([name]) => u < DRAGON_ATLAS[name].u1) ?? STRIPS.at(-1)!;
  const { u0, u1 } = DRAGON_ATLAS[strip];
  return paint((u - u0) / (u1 - u0), v);
};

const dataTexture = (canvas: HTMLCanvasElement) => {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
};

/** Albedo, normal (High), roughness (G) and glow (eyes, pearl) maps of the dragon atlas. */
const paintDragonMaps = (detailed: boolean) => {
  const size = detailed ? 512 : 128, painter = createAtlasPainter(size, size);
  const albedo = painter.context.createImageData(size, size);
  const surface = document.createElement("canvas"), glow = document.createElement("canvas");
  surface.width = surface.height = glow.width = glow.height = size;
  const finish = surface.getContext("2d")!.createImageData(size, size);
  const light = glow.getContext("2d")!.createImageData(size, size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const texel = paintTexel((column + .5) / size, 1 - (row + .5) / size), offset = (row * size + column) * 4;
    albedo.data.set([...texel.colour, 255], offset);
    finish.data.set([255, texel.rough * 255, 0, 255], offset);
    const glowing = texel.glow ?? 0;
    light.data.set([...texel.colour.map(channel => channel * glowing), 255], offset);
    painter.height[row * size + column] = texel.height;
  }
  painter.context.putImageData(albedo, 0, 0);
  surface.getContext("2d")!.putImageData(finish, 0, 0);
  glow.getContext("2d")!.putImageData(light, 0, 0);
  return {
    albedo: albedoTexture(painter),
    finish: dataTexture(surface),
    glow: dataTexture(glow),
    normal: detailed ? normalTexture(painter, 3 * size / 512) : null
  };
};

/** Painted once per detail level; every dragon material shares them. */
const cache = new Map<boolean, ReturnType<typeof paintDragonMaps>>();

/**
 * Lacquered carved dragon material (the building's own material for `dragon-coil` parts): green
 * scales, golden-ochre belly plates, orange flames, ivory horns and claws, amber eyes and a softly
 * glowing pearl from one atlas. High adds the normal map and a glossy clearcoat.
 */
export const createDragonLacquer = (_source: MeshStandardMaterial, detailed: boolean) => {
  const maps = cache.get(detailed) ?? paintDragonMaps(detailed);
  cache.set(detailed, maps);
  const parameters: MeshStandardMaterialParameters = {
    emissive: new Color(1, 1, 1),
    emissiveIntensity: .6,
    emissiveMap: maps.glow,
    map: maps.albedo,
    metalness: 0,
    normalMap: maps.normal,
    roughness: 1,
    roughnessMap: maps.finish
  };
  if (!detailed) return new MeshStandardMaterial(parameters);
  return new MeshPhysicalMaterial({ ...parameters, clearcoat: .5, clearcoatRoughness: .25 });
};
