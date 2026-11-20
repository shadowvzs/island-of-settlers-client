import { type IUniform, Vector4 } from "three";
import {
  attribute, cos, dot, float, Fn, modelPosition, modelWorldMatrixInverse, normalize, normalLocal,
  positionLocal, sin, smoothstep, uniform, vec2, vec3, vec4
} from "three/tsl";
import type { Material } from "three/webgpu";

import { SHIP_CLOTH_WIND } from "../../../render-common/ships/ship-cloth-wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const {
  attribute: CLOTH_ATTRIBUTE, calmBillow, flutterCalm, flutterStorm, gustFast, gustSlow, leeShift,
  luffBillow, luffFull, luffStart, restBillow, rippleA, rippleB, stormBillow
} = SHIP_CLOTH_WIND;

/** World wind as the sail shader receives it: time, unit xz direction and strength. */
export interface ShipClothWindUniform {
  uniform: IUniform<Vector4>;
}

export const isShipClothMaterial = (material: Material) =>
  (material as { userData?: { shipClothWind?: ShipClothWindUniform } }).userData?.shipClothWind !== undefined;

const directionOf = (angle: TslNode): TslNode => vec3(cos(angle), 0, sin(angle)) as TslNode;

const windOf = (localWind: TslNode): TslNode => {
  const length = localWind.x.mul(localWind.x).add(localWind.y.mul(localWind.y)).sqrt() as TslNode;
  return localWind.div(length.max(1e-5)) as TslNode;
};

/**
 * TSL twin of `SHIP_CLOTH_NORMAL_VERTEX` (ship-cloth-wind-glsl.ts): the belly offset of one cloth
 * vertex. Phase and world wind are passed in, so the material and the parity bench share the same
 * kernel. Mirrors `shipClothPoint` in render-common/ships/ship-cloth-wind.ts.
 */
export const createShipClothOffset = () => Fn(([
  position, cloth, localWind, time, strength, phase
]: [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode]) => {
  const direction = directionOf(cloth.x) as TslNode;
  const wind = windOf(localWind) as TslNode;
  const fill = float(1).sub(smoothstep(luffStart, luffFull, wind.y.negate())) as TslNode;
  const gust = float(1)
    .add(sin(time.mul(gustSlow[0]).add(phase)).mul(gustSlow[1]))
    .add(sin(time.mul(gustFast[0]).add(phase.mul(1.3))).mul(gustFast[1])) as TslNode;
  const billow = float(luffBillow).add(float(1 - luffBillow).mul(fill))
    .mul(float(calmBillow).add(float(stormBillow - calmBillow).mul(strength))) as TslNode;
  const ratio = billow.mul(gust).div(restBillow) as TslNode;
  const along = dot(wind, direction.xz) as TslNode;
  const lee = wind.sub(direction.xz.mul(along)).mul(cloth.y).mul(leeShift).mul(strength).mul(fill) as TslNode;
  const waveA = vec3(...rippleA.slice(1)) as TslNode;
  const waveB = vec3(...rippleB.slice(1)) as TslNode;
  const argumentA = time.mul(rippleA[0]).add(dot(position, waveA)).add(phase) as TslNode;
  const argumentB = time.mul(rippleB[0]).add(dot(position, waveB)).add(phase.mul(1.7)) as TslNode;
  const wave = sin(argumentA).add(sin(argumentB).mul(0.5)).div(1.5) as TslNode;
  const amplitude = cloth.z.mul(float(flutterCalm).add(float(flutterStorm).mul(strength)))
    .mul(float(2).sub(fill)) as TslNode;
  const push = cloth.y.mul(ratio.sub(1)).add(amplitude.mul(wave)) as TslNode;
  return direction.mul(push).add(vec3(lee.x, 0, lee.y)) as TslNode;
});

/** The bent normal of the same cloth vertex (`objectNormal` after the GLSL wind block). */
export const createShipClothNormal = () => Fn(([
  position, cloth, localWind, time, strength, phase, normal
]: [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode]) => {
  const direction = directionOf(cloth.x) as TslNode;
  const wind = windOf(localWind) as TslNode;
  const fill = float(1).sub(smoothstep(luffStart, luffFull, wind.y.negate())) as TslNode;
  const gust = float(1)
    .add(sin(time.mul(gustSlow[0]).add(phase)).mul(gustSlow[1]))
    .add(sin(time.mul(gustFast[0]).add(phase.mul(1.3))).mul(gustFast[1])) as TslNode;
  const billow = float(luffBillow).add(float(1 - luffBillow).mul(fill))
    .mul(float(calmBillow).add(float(stormBillow - calmBillow).mul(strength))) as TslNode;
  const ratio = billow.mul(gust).div(restBillow) as TslNode;
  const waveA = vec3(...rippleA.slice(1)) as TslNode;
  const waveB = vec3(...rippleB.slice(1)) as TslNode;
  const argumentA = time.mul(rippleA[0]).add(dot(position, waveA)).add(phase) as TslNode;
  const argumentB = time.mul(rippleB[0]).add(dot(position, waveB)).add(phase.mul(1.7)) as TslNode;
  const amplitude = cloth.z.mul(float(flutterCalm).add(float(flutterStorm).mul(strength)))
    .mul(float(2).sub(fill)) as TslNode;
  const facing = dot(normal, direction) as TslNode;
  const tangential = normal.sub(direction.mul(facing)) as TslNode;
  const slope = cos(argumentA).mul(waveA).add(cos(argumentB).mul(waveB).mul(0.5))
    .mul(amplitude).div(1.5) as TslNode;
  const tangentSlope = slope.sub(direction.mul(dot(slope, direction))) as TslNode;
  return normalize(direction.mul(facing)
    .add(tangential.mul(float(1).add(cloth.w.mul(ratio.sub(1)))))
    .sub(tangentSlope.mul(facing))) as TslNode;
});

export interface ShipClothNodes {
  normalNode: TslNode;
  positionNode: TslNode;
  syncUniforms: () => void;
}

/**
 * SHIP-WIND vertex graph for a standard node material: the shared uniform (time, world wind xz,
 * strength) is copied from the WebGL cloth uniform once per frame. No new vertex attribute is
 * added; the authored `clothWind` attribute already exists on sails and pennants.
 */
export const createShipClothNodes = (material: Material): ShipClothNodes | null => {
  const source = (material as { userData?: { shipClothWind?: ShipClothWindUniform } }).userData
    ?.shipClothWind;
  if (source === undefined) return null;
  const wind = uniform(new Vector4()) as TslNode;
  const cloth = attribute(CLOTH_ATTRIBUTE, "vec4") as TslNode;
  const local = modelWorldMatrixInverse.mul(vec4(wind.y, 0, wind.z, 0)).xyz as TslNode;
  const phase = dot(modelPosition.xz, vec2(0.37, 0.53)) as TslNode;
  const offset = createShipClothOffset()(positionLocal, cloth, local.xz, wind.x, wind.w, phase);
  const normal = createShipClothNormal()(positionLocal, cloth, local.xz, wind.x, wind.w, phase,
    normalLocal);
  return {
    normalNode: normal as TslNode,
    positionNode: positionLocal.add(offset) as TslNode,
    syncUniforms: () => { wind.value.copy(source.uniform.value); }
  };
};
