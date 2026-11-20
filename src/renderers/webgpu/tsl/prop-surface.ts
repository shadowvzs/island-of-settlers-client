import {
  abs,
  cameraPosition,
  clamp,
  cross,
  dot,
  float,
  Fn,
  fwidth,
  If,
  inverseSqrt,
  max,
  mix,
  normalize,
  smoothstep,
  texture,
  vec3,
  vec4
} from "three/tsl";
import type { Texture } from "three/webgpu";

import { LEAF_RELIEF } from "../../../render-common/trees/bark-shading";
import { BARK_FAMILY, BARK_FAMILY_STRIDE, BARK_UV_LIMIT, BARK_UV_OFFSET } from "../../../render-common/trees/bark-uv";
import { barkFamilyOf, type BarkLight, createBarkShaders } from "./prop-bark";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

export interface PropSurfaceOptions extends BarkLight {
  highlight: TslNode;
  leafNormals: Texture;
  /** 1 under an orthographic camera (GLSL `projectionMatrix[3][3] > 0.5`). */
  orthographic: TslNode;
  sunColor: TslNode;
  sunDirection: TslNode;
  valueNoise: NoiseNode;
  viewDirection: TslNode;
}

/** LEAF_ATLAS_UV_GLSL: atlas uvs lie in 0..1; wood and untextured vertices use u <= -1. */
export const isLeafAtlasUv = (uv: TslNode): TslNode => uv.x.greaterThan(-0.5);

/** LEAF_GLSL `sharpenCoverage`: crisp minified alpha for alpha to coverage / alpha test. */
export const sharpenCoverage = (alpha: TslNode): TslNode =>
  clamp(alpha.sub(0.5).div(max(fwidth(alpha), 0.0001)).add(0.5), 0, 1);

/** LEAF_NORMAL_GLSL: per-leaf relief from the tangent-space atlas normal map (screen derivatives). */
const createLeafNormal = (leafNormals: Texture) =>
  (normal: TslNode, world: TslNode, uv: TslNode): TslNode => {
    const q0 = world.dFdx();
    const q1 = world.dFdy();
    const st0 = uv.dFdx();
    const st1 = uv.dFdy();
    const plane = cross(q0, q1);
    const q1Perp = cross(q1, plane);
    const q0Perp = cross(plane, q0);
    const tangent = q1Perp.mul(st0.x).add(q0Perp.mul(st1.x));
    const bitangent = q1Perp.mul(st0.y).add(q0Perp.mul(st1.y));
    const frame = max(dot(tangent, tangent), dot(bitangent, bitangent));
    const relief = texture(leafNormals, uv).xyz.mul(2).sub(1);
    const slope = tangent.mul(relief.x).add(bitangent.mul(relief.y)).mul(inverseSqrt(max(frame, 1e-30)));
    const perturbed = normalize(normal.mul(relief.z).add(slope.mul(LEAF_RELIEF)));
    return frame.lessThanEqual(0).select(normal, perturbed);
  };

/** TREE_SHADING_GLSL `getCardFacing`: edge-on leaf cards drop out by the eye angle. */
const createCardFacing = (orthographic: TslNode, viewDirection: TslNode) => (world: TslNode): TslNode => {
  const plane = normalize(cross(world.dFdx(), world.dFdy()));
  const eye = orthographic.greaterThan(0.5).select(viewDirection, normalize(cameraPosition.sub(world)));
  return smoothstep(0.07, 0.13, abs(dot(plane, eye)));
};

/** PROP_SHADING_GLSL + LEAF_LIGHT_GLSL: the prop light, back light through leaves and their sheen. */
export type PropLightOptions =
  Pick<PropSurfaceOptions, "highlight" | "lightSurface" | "sunColor" | "sunDirection" | "viewDirection">;

export const createPropLight = (options: PropLightOptions, backLightWeight: TslNode) => {
  const { highlight, lightSurface, sunColor, sunDirection, viewDirection } = options;

  const lightProp = (albedo: TslNode, normal: TslNode, sunVisibility: TslNode, xz: TslNode): TslNode => {
    const backLight = max(dot(normal.negate(), sunDirection), 0).mul(sunVisibility).mul(0.18)
      .mul(backLightWeight);
    return lightSurface(albedo, normal, sunVisibility, 1, xz).add(albedo.mul(sunColor).mul(backLight));
  };

  const lightLeaf = (albedo: TslNode, normal: TslNode, sunVisibility: TslNode, xz: TslNode): TslNode => {
    const facingSun = max(dot(viewDirection, sunDirection).negate(), 0);
    const through = max(dot(normal.negate(), sunDirection), 0)
      .mul(facingSun.pow(2).mul(0.75).add(0.25)).mul(backLightWeight);
    const glow = albedo.mul(vec3(1.1, 1.25, 0.5)).mul(through).mul(0.5);
    const sheen = max(dot(normal, normalize(sunDirection.add(viewDirection))), 0).pow(24);
    const extra = glow.add(vec3(0.9, 1, 0.82).mul(sheen).mul(0.05).mul(highlight))
      .mul(sunColor).mul(sunVisibility);
    return lightProp(albedo, normal, sunVisibility, xz).add(extra);
  };

  return { lightLeaf, lightProp };
};

const familyBetween = (uv: TslNode, family: TslNode, first: number, last: number): TslNode =>
  uv.x.lessThan(BARK_UV_LIMIT).and(family.greaterThanEqual(first)).and(family.lessThanEqual(last));

/**
 * `lightPropSurface` of PROP_FRAGMENT_GLSL, in its order: hardwood leaves, shells (plain prop light:
 * not ported yet), birch, conifer, palm and oak bark, atlas leaves, the plain prop light.
 */
export const createPropSurface = (options: PropSurfaceOptions) => {
  const birchStart = BARK_UV_OFFSET + BARK_FAMILY.birch * BARK_FAMILY_STRIDE;

  /**
   * TSL emits a node shared by several branches as one variable, assigned where it is first built:
   * every value the branches share is bound before the branch chain, or later branches read 0.
   */
  const lightSurfaceOf = Fn(([albedoInput, normalInput, uvInput, worldInput, sunInput]:
  [TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const [albedo, normal, uv, world, sunVisibility] =
      [albedoInput, normalInput, uvInput, worldInput, sunInput].map(input => input.toVar());
    const backLightWeight = mix(0.3, 1, smoothstep(0.15, 0.5, options.sunDirection.y)).toVar();
    const { lightLeaf, lightProp } = createPropLight(options, backLightWeight);
    const bark = createBarkShaders(options.valueNoise, { ...options, ambient: options.ambient.toVar() });
    const family = barkFamilyOf(uv).toVar();
    const birchOffset = uv.x.negate().sub(birchStart);
    const result = vec3(0).toVar();
    If(uv.x.greaterThan(-1.4).and(uv.x.lessThan(-1.1)), () => {
      result.assign(lightLeaf(albedo, normal, sunVisibility, world.xz));
    }).ElseIf(familyBetween(uv, family, BARK_FAMILY.shellBivalve, BARK_FAMILY.spiralShell), () => {
      result.assign(lightProp(albedo, normal, sunVisibility, world.xz));
    }).ElseIf(birchOffset.greaterThanEqual(0).and(birchOffset.lessThan(BARK_FAMILY_STRIDE)), () => {
      result.assign(bark.birch(albedo, normal, uv, world, sunVisibility));
    }).ElseIf(familyBetween(uv, family, BARK_FAMILY.spruce, BARK_FAMILY.mountainPine), () => {
      result.assign(bark.conifer(albedo, normal, uv, world, sunVisibility));
    }).ElseIf(familyBetween(uv, family, BARK_FAMILY.palmRinged, BARK_FAMILY.palmFibrous), () => {
      result.assign(bark.palm(albedo, normal, uv, world, sunVisibility));
    }).ElseIf(uv.x.lessThan(BARK_UV_LIMIT), () => {
      result.assign(bark.oak(albedo, normal, uv, world, sunVisibility));
    }).ElseIf(isLeafAtlasUv(uv), () => {
      result.assign(lightLeaf(albedo, normal, sunVisibility, world.xz));
    }).Else(() => {
      result.assign(lightProp(albedo, normal, sunVisibility, world.xz));
    });
    return result;
  });

  const leafNormal = createLeafNormal(options.leafNormals);
  const cardFacing = createCardFacing(options.orthographic, options.viewDirection);

  /**
   * Leaf atlas colour/coverage; atlas cards fade edge-on and take the leaf relief. Call inside an Fn:
   * the atlas test and sample are pinned there, before the surface branches that also read them (P33).
   */
  const shadeLeaf = (leaf: TslNode, color: TslNode, normal: TslNode, uv: TslNode, world: TslNode) => {
    const atlas = isLeafAtlasUv(uv).toVar();
    const sample = atlas.select(leaf, vec4(1)).toVar();
    const coverage = sharpenCoverage(sample.a).mul(atlas.select(cardFacing(world), float(1)));
    const surfaceNormal = atlas.select(leafNormal(normal, world, uv), normal);
    return { albedo: color.mul(sample.rgb), coverage, normal: surfaceNormal };
  };

  return { lightSurfaceOf, shadeLeaf };
};
