import { abs, clamp, dot, float, max, mix, smoothstep, vec2, vec3 } from "three/tsl";

import { GROUND_CLIMATE_TUNING } from "../../../render-common/shaders/ground-climate-glsl";
import { getVariantNoise } from "./terrain-variants";

type TslNode = any; // TSL's generated types do not model the proxied node methods;

const tuning = GROUND_CLIMATE_TUNING;

/** `getHeatherMask` × `applyHeather` of ground-climate-glsl.ts: purple-brown heather on cold, exposed grass. */
export const applyTslHeather = (albedo: TslNode, grass: TslNode, heather: TslNode, dry: TslNode, world: TslNode) => {
  const exposed = max(smoothstep(tuning.heatherDry[0], tuning.heatherDry[1], dry),
    smoothstep(tuning.heatherHeight[0], tuning.heatherHeight[1], world.y)) as TslNode;
  const patches = smoothstep(tuning.heatherPatch[0], tuning.heatherPatch[1],
    getVariantNoise(world.xz.mul(0.19).add(47))) as TslNode;
  const mask = grass.mul(heather).mul(exposed).mul(patches).mul(tuning.heatherShare) as TslNode;
  const grain = clamp(dot(albedo, vec3(0.333)).div(tuning.heatherGrassLuma), 0.6, 1.5) as TslNode;
  const bloom = smoothstep(0.4, 0.8, getVariantNoise(world.xz.mul(2.3).add(13))) as TslNode;
  const shrub = mix(vec3(...tuning.heatherShrub), vec3(...tuning.heatherBloom), bloom).mul(grain) as TslNode;
  return mix(albedo, shrub, mask) as TslNode;
};

/** `applyDuneGrass`: dune grass clumps on the sand behind a beach. */
export const applyTslDuneGrass = (albedo: TslNode, zone: TslNode, sand: TslNode, height: TslNode, xz: TslNode) => {
  const share = zone.mul(sand).mul(smoothstep(tuning.duneHeight[0], tuning.duneHeight[1], height)) as TslNode;
  const clumps = smoothstep(tuning.duneClumps[0], tuning.duneClumps[1],
    getVariantNoise(xz.mul(1.4).add(61)).add(share.mul(0.3)).sub(0.15)) as TslNode;
  const turned = vec2(xz.x.mul(0.6).add(xz.y.mul(0.8)), xz.y.mul(0.6).sub(xz.x.mul(0.8))) as TslNode;
  const blades = getVariantNoise(turned.mul(3.1).add(7)) as TslNode;
  const grass = vec3(...tuning.duneGrass).mul(mix(0.8, 1.15, blades)) as TslNode;
  return mix(albedo, grass, clumps.mul(share).mul(tuning.duneShare)) as TslNode;
};

/** `getTidalFlat`: flat beach ground in calm bays from the water's edge to just above it, frayed edges. */
export const getTslTidalFlat = (coast: TslNode, sand: TslNode, height: TslNode, normal: TslNode, xz: TslNode,
  cold: TslNode) => {
  const beach = float(1).sub(smoothstep(tuning.tidalCoast[0], tuning.tidalCoast[1], coast)) as TslNode;
  const level = smoothstep(tuning.tidalFlat[0], tuning.tidalFlat[1], normal.y) as TslNode;
  const wobbled = height.add(getVariantNoise(xz.mul(0.7).add(19)).sub(0.5).mul(tuning.tidalWobble * 2)) as TslNode;
  const band = smoothstep(tuning.tidalDepth[0], tuning.tidalDepth[1], wobbled)
    .mul(float(1).sub(smoothstep(tuning.tidalHeight[0], tuning.tidalHeight[1], wobbled))) as TslNode;
  const calm = smoothstep(tuning.tidalCalm[0], tuning.tidalCalm[1], getVariantNoise(xz.mul(0.045).add(71))) as TslNode;
  const flat = beach.mul(level).mul(band).mul(calm).mul(sand).mul(float(1).sub(cold)) as TslNode;
  const edge = getVariantNoise(xz.mul(1.3).add(41)).add(flat.mul(0.45)).sub(0.1) as TslNode;
  return flat.mul(smoothstep(tuning.tidalEdge[0], tuning.tidalEdge[1], edge)) as TslNode;
};

/** `applyTidalSilt`: pale grey wet silt over the sand (its brightness, greyed and cooled, faintly mottled). */
export const applyTslTidalSilt = (albedo: TslNode, tidal: TslNode, xz: TslNode) => {
  const luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722)) as TslNode;
  const turned = vec2(xz.x.mul(0.8).add(xz.y.mul(0.6)), xz.y.mul(0.8).sub(xz.x.mul(0.6))) as TslNode;
  const mottle = mix(0.94, 1.04, getVariantNoise(turned.mul(2.4).add(23))) as TslNode;
  const silt = mix(albedo, vec3(luma), tuning.tidalGrey).mul(vec3(...tuning.tidalTint)).mul(mottle) as TslNode;
  return mix(albedo, silt, tidal.mul(tuning.tidalShare)) as TslNode;
};

/** `getWrackLine` × `applyWrackLine`: the thin, broken olive weed band at the high-tide line. */
export const applyTslWrackLine = (albedo: TslNode, height: TslNode, coast: TslNode, sand: TslNode, xz: TslNode,
  open: TslNode) => {
  const wobble = getVariantNoise(xz.mul(0.35).add(83)).sub(0.5).mul(tuning.wrackWobble * 2)
    .add(getVariantNoise(xz.mul(1.7).add(5)).sub(0.5).mul(0.02)) as TslNode;
  const offset = abs(height.sub(tuning.wrackHeight).sub(wobble)) as TslNode;
  const beach = float(1).sub(smoothstep(0.15, 0.4, coast)).mul(sand).mul(open)
    .mul(smoothstep(0.25, 0.35, sand)) as TslNode;
  const weed = float(1).sub(smoothstep(tuning.wrackWidth[0], tuning.wrackWidth[1], offset)) as TslNode;
  const broken = smoothstep(tuning.wrackBroken[0], tuning.wrackBroken[1], getVariantNoise(xz.mul(0.5).add(97))) as TslNode;
  const turned = vec2(xz.x.mul(0.8).sub(xz.y.mul(0.6)), xz.x.mul(0.6).add(xz.y.mul(0.8))) as TslNode;
  const tangles = smoothstep(0.25, 0.75, getVariantNoise(turned.mul(3.3).add(11))) as TslNode;
  const stain = float(1).sub(smoothstep(0, tuning.wrackStain, offset)).mul(broken).mul(0.5).mul(beach) as TslNode;
  const share = weed.mul(broken).mul(mix(0.45, 1, tangles)).mul(beach) as TslNode;
  const shade = mix(0.75, 1.2, getVariantNoise(xz.mul(2.6).add(3))) as TslNode;
  const stained = albedo.mul(float(1).sub(stain.mul(0.14))) as TslNode;
  return mix(stained, vec3(...tuning.wrackOlive).mul(shade), share.mul(tuning.wrackShare)) as TslNode;
};

/** `applyJungleFloor`: dark, damp, warm olive forest floor under the tropical canopy. */
export const applyTslJungleFloor = (albedo: TslNode, forest: TslNode, jungle: TslNode) =>
  albedo.mul(mix(vec3(1), vec3(...tuning.jungleFloor), clamp(forest.mul(jungle), 0, 1))) as TslNode;
