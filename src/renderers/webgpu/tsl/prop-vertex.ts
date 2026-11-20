import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  cross,
  dot,
  float,
  fract,
  Fn,
  If,
  length,
  mix,
  normalize,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4
} from "three/tsl";

import { PROP_CUT_HEIGHT } from "../../../render-common/felling/felling-trees";
import { SPRING_BLOOM } from "../../../render-common/seasonal-appearance/spring-bloom";
import { RAIN_LUSH_TINT } from "../../../render-common/shaders/ground-common-glsl";
import { PROP_FALL_ANGLE } from "../../../render-common/shaders/prop-glsl";
import { TRAFFIC_WEAR_TUNING } from "../../../render-common/traffic-wear-tuning";
import { createGrassKeepNodes } from "./prop-grass";
import { instanceMatrixColumn, propVertexAttribute } from "./prop-instance";
import { createTslScorchGrassKeep } from "./terrain-scorch";
import { createTslSeasonTuftSnow, getTslSeasonTuftTint } from "./terrain-season";
import { bindScalar, bindTexture, bindVector, type UniformBindings } from "./uniform-bindings";
import type { createWindNodes } from "./wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;
type LiveFog = (visibility: TslNode, xz: TslNode) => TslNode;

/** GLSL's off-screen vertex for a hidden instance (`gl_Position = vec4(2, 2, 2, 1)`). */
const HIDDEN_CLIP = vec4(2, 2, 2, 1);
const UP = vec3(0, 1, 0);

export interface PropVertexOptions {
  bindings: UniformBindings;
  choppable: boolean;
  isGrass: boolean;
  liveFog: LiveFog;
  /** The global season can snow (SEASON_SNOW): the field-cover tufts thin and grey under its cover. */
  seasonSnow?: boolean;
  /** Spring meadow flowers (SPRING_BLOOM): each instance opens with the spring weight. */
  springBloom?: boolean;
  valueNoise: NoiseNode;
  wind: ReturnType<typeof createWindNodes>;
}

/** SPRING_BLOOM_GLSL getSpringBloom: the open state of a flower whose bloom point rides in its phase. */
const createSpringBloom = (bindings: UniformBindings, phase: TslNode): TslNode => {
  const { fullAt, openSpan, startAt } = SPRING_BLOOM;
  const ramp = smoothstep(startAt, fullAt, bindVector(bindings, "uSeason", 4).z);
  const point = fract(phase.mul(0.15915494));
  return smoothstep(point, point.add(openSpan), ramp.mul(1 + openSpan));
};

/** The interpolated prop inputs of the fragment stage (GLSL vWorld/vNormal/vColor/vInstance). */
export interface PropVaryingSources {
  clip: TslNode;
  /** Instance phase and prop-space position: the season tint's tree and cluster picks. */
  phase: TslNode;
  position: TslNode;
  color: TslNode;
  instance: TslNode;
  normal: TslNode;
  uv: TslNode;
  world: TslNode;
}

/** `isHiddenByFog` (PROP_FOG_GLSL): unexplored land dissolves its props with a noisy edge. */
export const createPropFogHiding = (liveFog: LiveFog, valueNoise: NoiseNode) =>
  (fog: TslNode, xz: TslNode): TslNode =>
    liveFog(fog, xz).lessThan(float(0.24).add(valueNoise(xz.mul(0.7)).mul(0.16)));

const rotateAboutAxis = (vector: TslNode, axis: TslNode, angle: TslNode): TslNode => {
  const c = cos(angle);
  return vector.mul(c).add(cross(axis, vector).mul(sin(angle)))
    .add(axis.mul(dot(axis, vector)).mul(float(1).sub(c)));
};

/** PROP_CHOP_GLSL: the axe rattle, then the fall about the cut (what lies below the cut stays). */
const chopPropPosition = Fn(([position, wind, chop, fallDirection, time]:
[TslNode, TslNode, TslNode, TslNode, TslNode]) => {
  const across = vec3(fallDirection.z.negate(), 0, fallDirection.x);
  const rattle = sin(time.mul(36).add(position.y.mul(3))).mul(chop.x);
  const rattled = position.add(across.mul(0.6).add(fallDirection.mul(0.4)).mul(rattle)
    .mul(wind.x.mul(0.12).add(wind.y.mul(0.03))));
  const result = rattled.toVar();
  If(chop.y.greaterThan(0), () => {
    const pivot = vec3(0, PROP_CUT_HEIGHT, 0);
    const axis = normalize(cross(UP, fallDirection));
    const fallen = pivot.add(rotateAboutAxis(rattled.sub(pivot), axis, chop.y.mul(PROP_FALL_ANGLE)));
    const sunk = fallen.sub(vec3(0, chop.w.mul(1.6), 0));
    result.assign(rattled.y.lessThan(PROP_CUT_HEIGHT).select(vec3(0, PROP_CUT_HEIGHT * 0.5, 0), sunk));
  });
  return result;
});

const chopPropNormal = (normal: TslNode, chop: TslNode, fallDirection: TslNode): TslNode => {
  const axis = normalize(cross(UP, fallDirection));
  return chop.y.lessThanEqual(0).select(normal, rotateAboutAxis(normal, axis, chop.y.mul(PROP_FALL_ANGLE)));
};

/**
 * `trafficGrassKeep` (TRAFFIC_GRASS_GLSL) × `scorchGrassKeep` (SCORCH_GRASS_GLSL): trampled ground keeps 15 % of its
 * tufts, packed-earth yards and fresh ruin scorch none.
 */
export const createTrafficGrassKeep = (bindings: UniformBindings) => {
  const wear = bindTexture(bindings, "uTrafficWear");
  const scorchKeep = createTslScorchGrassKeep(bindings);
  const printStart = TRAFFIC_WEAR_TUNING.printLines[1]![0];
  const [bareStart, bareFull] = TRAFFIC_WEAR_TUNING.grassBare;
  return (root: TslNode): TslNode => {
    const size = vec2(wear.size(0));
    const sample = texture(wear, root.mul(TRAFFIC_WEAR_TUNING.texelsPerCell).div(size)).r;
    const trodden = float(1).sub(smoothstep(printStart, TRAFFIC_WEAR_TUNING.fillFull, sample).mul(0.85));
    return trodden.mul(float(1).sub(smoothstep(bareStart, bareFull, sample))).mul(scorchKeep(root));
  };
};

/** Grass: range/ring/rank keep, then (GRASS_COVER) fog hiding and trampling. */
const createGrassCoverKeep = (options: PropVertexOptions, root: TslNode, data: TslNode) => {
  const { bindings, liveFog, valueNoise } = options;
  const { grassKeep } = createGrassKeepNodes(valueNoise);
  const keep = grassKeep(bindVector(bindings, "uGrassRange", 4), bindVector(bindings, "uGrassHole", 4),
    bindVector(bindings, "uGrassHoleShape", 4), root, data.x);
  const hidden = createPropFogHiding(liveFog, valueNoise)(data.z, root);
  return hidden.select(float(0), keep.mul(createTrafficGrassKeep(bindings)(root)));
};

/**
 * TSL twin of PROP_VERTEX_GLSL: flutter and branch sway in prop space, the grass fade and keep,
 * the felling deformation, the instance transform and the world-space wind lean. Hidden instances
 * (instanceData.w > 0.5, or a grass keep of 0) leave the clip volume as in GLSL.
 */
export const createPropVertex = (options: PropVertexOptions): PropVaryingSources => {
  const { bindings, choppable, isGrass, wind } = options;
  const position = propVertexAttribute("position");
  const normal = propVertexAttribute("normal");
  const weights = propVertexAttribute("wind");
  const data = attribute("instanceData", "vec4") as TslNode;
  const columns = ([0, 1, 2, 3] as const).map(instanceMatrixColumn);
  const [axisX, axisY, axisZ, origin] = columns.map(column => column.xyz);
  const root = origin.xz;
  const phase = data.x;
  const time = bindScalar(bindings, "uTime");
  const windVector = bindVector(bindings, "uWind", 2);
  const bloom = options.springBloom ? createSpringBloom(bindings, phase) : null;
  const tuftSnow = isGrass && options.seasonSnow
    ? createTslSeasonTuftSnow(bindings, options.valueNoise)(root, phase) : null;
  const grassCoverKeep = isGrass ? createGrassCoverKeep(options, root, data) : float(1);
  const coverKeep = tuftSnow ? grassCoverKeep.mul(tuftSnow.keep) : grassCoverKeep;
  const grassKeep = bloom ? coverKeep.mul(bloom) : coverKeep;
  const fade = isGrass ? bindScalar(bindings, "uGrassFade") : float(1);
  const sway = wind.flutterOffset(position, phase, time).mul(weights.y)
    .add(wind.branchSway(position, phase, time, windVector).mul(weights.x));
  let local: TslNode = position.add(sway).mul(vec3(1, fade, 1)).mul(grassKeep);
  let localNormal: TslNode = normal;
  let standing: TslNode = float(1);
  if (choppable) {
    const chop = attribute("instanceChop", "vec4") as TslNode;
    const fall = vec3(cos(chop.z), 0, sin(chop.z));
    const fallDirection = normalize(vec3(dot(axisX, fall), dot(axisY, fall), dot(axisZ, fall)));
    local = chopPropPosition(local, weights, chop, fallDirection, time);
    localNormal = chopPropNormal(normal, chop, fallDirection);
    standing = float(1).sub(chop.y);
  }
  const transformed = axisX.mul(local.x).add(axisY.mul(local.y)).add(axisZ.mul(local.z)).add(origin);
  const lean = wind.windDisplacement(root, phase, time, windVector, bindVector(bindings, "uWindPhase", 2))
    .mul(weights.x).mul(length(axisX)).mul(standing);
  const world = transformed.add(vec3(lean.x, 0, lean.y));
  let color: TslNode = propVertexAttribute("color").mul(attribute("instanceTint", "vec3"));
  if (isGrass) color = color.mul(mix(vec3(1), vec3(...RAIN_LUSH_TINT), bindScalar(bindings, "uRain")));
  if (isGrass && !bloom) color = color.mul(getTslSeasonTuftTint(bindings, position.y));
  if (tuftSnow) color = tuftSnow.tint(color);
  if (bloom) {
    const bud = vec3(...SPRING_BLOOM.budTone).mul(attribute("instanceTint", "vec3"));
    color = mix(bud, color, smoothstep(0.35, 1, bloom));
  }
  const hidden = data.w.greaterThan(0.5).or(grassKeep.lessThanEqual(0));
  const projected = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
  return {
    clip: hidden.select(HIDDEN_CLIP, projected),
    color,
    phase,
    position,
    instance: data.yzw,
    normal: normalize(axisX.mul(localNormal.x).add(axisY.mul(localNormal.y)).add(axisZ.mul(localNormal.z))),
    uv: propVertexAttribute("uv"),
    world
  };
};
