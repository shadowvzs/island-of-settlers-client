import { abs, float, int, mix, smoothstep, texture, vec2, vec3, vec4 } from "three/tsl";
import type { Texture } from "three/webgpu";

import { CLIFF_GRAIN_SCALE } from "../../../render-common/shaders/ground-cliff-glsl";
import { MATERIAL_TILE_UNITS } from "../../../render-common/shaders/ground-common-glsl";
import { ROCK_MACRO } from "../../../render-common/shaders/ground-glsl";
import { MATERIAL } from "../../../shared/world/world-data";
import { applyCliffBeds, getCliffBeds } from "./terrain-nodes";

/** Wall rock and summit snow layer of the TSL terrain (GLSL ground-glsl.ts, ground-cliff-glsl.ts). */
type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** One ground texture array layer with explicit gradients. */
export const arraySample = (source: Texture, uv: TslNode, dx: TslNode, dy: TslNode, layer: number) =>
  texture(source, uv).depth(int(layer)).grad(dx, dy) as TslNode;

/** GLSL ROCK_MACRO_TURN (column-major mat2) applied to a 2D node. */
const turnRockMacro = (value: TslNode) => {
  const [a, b, c, d] = ROCK_MACRO.turn;
  return vec2(value.x.mul(a).add(value.y.mul(c)), value.x.mul(b).add(value.y.mul(d))) as TslNode;
};

/** GLSL `sampleRockSide`: one side projection of the wall rock, mixed with its coarser turned octave. */
const sampleRockSide = (source: Texture, uv: TslNode, dx: TslNode, dy: TslNode, scale: number) => {
  const near = arraySample(source, uv.mul(scale), dx.mul(scale), dy.mul(scale), MATERIAL.rock);
  const macroScale = scale * ROCK_MACRO.scale;
  const far = arraySample(source, turnRockMacro(uv.mul(macroScale)).add(0.37),
    turnRockMacro(dx.mul(macroScale)), turnRockMacro(dy.mul(macroScale)), MATERIAL.rock);
  return mix(near, far, ROCK_MACRO.share) as TslNode;
};

export interface WallRockInputs {
  albedo: TslNode;
  albedoTexture: Texture;
  cliff: TslNode;
  normal: TslNode;
  normalTexture: Texture;
  scale: number;
  valueNoise: (point: TslNode) => TslNode;
  world: TslNode;
  worldDx: TslNode;
  worldDy: TslNode;
}

/** Three planar projections of a ground layer: side (x), top and front (z). */
const samplePlanar = (source: Texture, inputs: WallRockInputs, layer: number, scale: number) => {
  const { world, worldDx, worldDy } = inputs;
  const project = (axes: "zy" | "xz" | "xy") =>
    arraySample(source, world[axes].mul(scale), worldDx[axes].mul(scale), worldDy[axes].mul(scale), layer);
  return { front: project("xy"), side: project("zy"), top: project("xz") };
};

/**
 * GLSL sampleRockTriplanar + applyCliffBeds + sampleWallNormal: the rock layer seen from the side
 * (tile and its turned macro octave), the wall's side-projected apron gravel and its relief normal.
 */
export const sampleWallRock = (inputs: WallRockInputs) => {
  const { albedo, albedoTexture, cliff, normal, normalTexture, scale, valueNoise, world, worldDx, worldDy } = inputs;
  // GLSL getPlanarBlend: the weights sum to one (a unit-length blend over-brightened oblique faces).
  const powered = abs(normal).pow(vec3(4)) as TslNode;
  const blend = powered.div(powered.x.add(powered.y).add(powered.z)) as TslNode;
  const gravelScale = CLIFF_GRAIN_SCALE / MATERIAL_TILE_UNITS[MATERIAL.mine]!;
  const gravel = samplePlanar(albedoTexture, inputs, MATERIAL.mine, gravelScale);
  const gravelColour = gravel.side.rgb.mul(blend.x).add(gravel.top.rgb.mul(blend.y))
    .add(gravel.front.rgb.mul(blend.z)) as TslNode;
  const rockX = sampleRockSide(albedoTexture, world.zy, worldDx.zy, worldDy.zy, scale);
  const rockZ = sampleRockSide(albedoTexture, world.xy, worldDx.xy, worldDy.xy, scale);
  const triplanar = rockX.mul(blend.x).add(albedo.mul(blend.y)).add(rockZ.mul(blend.z)) as TslNode;
  const relief = samplePlanar(normalTexture, inputs, MATERIAL.mine, gravelScale);
  const wallX = relief.side.rg.mul(2).sub(1) as TslNode;
  const wallTop = relief.top.rg.mul(2).sub(1) as TslNode;
  const wallZ = relief.front.rg.mul(2).sub(1) as TslNode;
  return {
    albedo: applyCliffBeds(triplanar.rgb, gravelColour, getCliffBeds(world, valueNoise), cliff) as TslNode,
    alpha: triplanar.a as TslNode,
    normal: vec3(0, wallX.y, wallX.x).mul(blend.x).add(vec3(wallTop.x, 0, wallTop.y).mul(blend.y))
      .add(vec3(wallZ.x, wallZ.y, 0).mul(blend.z)) as TslNode
  };
};

/**
 * GLSL applySummitSnowLayer (edge cue 1): inside the summit snow field the pits fill (flat normal, no
 * rock occlusion), a brighter lip runs along its edge and the rock just outside takes a contact shade.
 */
export const applySummitSnowLayer = (albedo: TslNode, surface: TslNode, layer: TslNode) => {
  const lip = smoothstep(0.4, 0.75, layer).mul(float(1).sub(smoothstep(0.9, 1, layer))) as TslNode;
  const contact = smoothstep(0.02, 0.15, layer).mul(float(1).sub(smoothstep(0.2, 0.4, layer))) as TslNode;
  return {
    albedo: albedo.mul(float(1).add(lip.mul(0.1)).sub(contact.mul(0.18))) as TslNode,
    surface: vec4(surface.xy.mul(float(1).sub(layer.mul(0.9))), mix(surface.z, 1, layer.mul(0.9)),
      surface.w) as TslNode
  };
};
