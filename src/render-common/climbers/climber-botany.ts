import { DMath } from "../../shared/math/deterministic-math";
import { rgb, srgbToLinear } from "../color";
import type { ClimberFoliageTileId } from "../plants/climber-foliage-atlas-layout";
import { foliagePartBounds } from "../plants/climber-foliage-geometry";
import { normalize, type Vec3 } from "../props/mesh-builder";
import type { RoadDecorationPart, RoadFoliageCard, RoadRoseHead } from "../road-decoration-recipe";

export type Point = [number, number, number];
export type Colour = [number, number, number];

/** Authored sRGB hex to the linear vertex tint (the atlas body albedo is a neutral ~0.8). */
export const linearHex = (hex: number): Colour => srgbToLinear(...rgb(hex));

/** Deterministic 0..1 noise per integer-ish seed. */
export const botanyNoise = (seed: number) => {
  const value = DMath.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Blend between two authored tints by a stable seed (natural spread inside one palette). */
export const paletteTint = (from: Colour, to: Colour, seed: number): Colour => {
  const t = botanyNoise(seed);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
};

export const offset = (point: Vec3, direction: Vec3, distance: number): Point =>
  [point[0] + direction[0] * distance, point[1] + direction[1] * distance, point[2] + direction[2] * distance];

/** Position and unit tangent at arc fraction `t` of a polyline. */
export const samplePolyline = (points: readonly Vec3[], t: number) => {
  const lengths = [0];
  for (let index = 1; index < points.length; index++)
    lengths.push(lengths[index - 1]! + DMath.hypot(...points[index]!.map((value, axis) =>
      value - points[index - 1]![axis]!) as Point));
  const target = Math.max(0, Math.min(1, t)) * lengths.at(-1)!;
  let segment = 1;
  while (segment < points.length - 1 && lengths[segment]! < target) segment++;
  const from = points[segment - 1]!, to = points[segment]!;
  const span = Math.max(lengths[segment]! - lengths[segment - 1]!, 1e-9);
  const local = (target - lengths[segment - 1]!) / span;
  const tangent = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  return { point: [0, 1, 2].map(axis => from[axis]! + (to[axis]! - from[axis]!) * local) as Point, tangent };
};

/** Traffic opening of the climber arches plus the leaf-flutter margin (both LODs); cards also stay above ground. */
export interface ClimberOpening { halfWidth: number; height: number }
const FLUTTER_MARGIN = .035;

const clearsOpening = (part: RoadFoliageCard | RoadRoseHead, opening: ClimberOpening) => {
  const box = foliagePartBounds(part);
  // Nothing may dip into the verge soil either.
  if (box.min[1] < .002) return false;
  if (box.min[1] >= opening.height + FLUTTER_MARGIN) return true;
  const limit = opening.halfWidth + FLUTTER_MARGIN;
  return box.min[0] >= limit || box.max[0] <= -limit;
};

const mirrored = (vector: Point, side: number): Point =>
  [Math.abs(vector[0]) * side, vector[1], vector[2]];

/**
 * Adds a card only where it clears the traffic opening; a low card that points into the road is
 * turned to grow outward first (leaves face the light outside the arch, as on a real hedge).
 */
export const addClearCard = (parts: RoadDecorationPart[], card: Omit<RoadFoliageCard, "kind" | "surface">,
  opening: ClimberOpening) => {
  const part: RoadFoliageCard = { ...card, kind: "foliage-card", surface: "foliage" };
  if (clearsOpening(part, opening)) { parts.push(part); return true; }
  const side = Math.sign(card.position[0]) || 1;
  const turned: RoadFoliageCard = { ...part, facing: mirrored(card.facing, side), up: mirrored(card.up, side) };
  if (!clearsOpening(turned, opening)) return false;
  parts.push(turned);
  return true;
};

export const addClearHead = (parts: RoadDecorationPart[], head: Omit<RoadRoseHead, "kind" | "surface">,
  opening: ClimberOpening) => {
  const part: RoadRoseHead = { ...head, kind: "rose-head", surface: "foliage" };
  if (!clearsOpening(part, opening)) return false;
  parts.push(part);
  return true;
};

export const addStem = (parts: RoadDecorationPart[], points: Point[], radius: readonly [number, number],
  sides: number, tint: Colour) => {
  if (points.length >= 2) parts.push({ kind: "climber-stem", points, radius, sides, surface: "wood", tint });
};

export interface CardSpec { tile: ClimberFoliageTileId; size: number; tint: Colour; curl?: number }
