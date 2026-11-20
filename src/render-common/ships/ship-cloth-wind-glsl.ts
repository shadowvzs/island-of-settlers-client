import { SHIP_CLOTH_WIND } from "./ship-cloth-wind";

const {
  attribute, calmBillow, flutterCalm, flutterStorm, gustFast, gustSlow, leeShift, luffBillow, luffFull, luffStart,
  restBillow, rippleA, rippleB, stormBillow
} = SHIP_CLOTH_WIND;
const float = (value: number) => value.toFixed(4);
const vector = (values: readonly number[]) => `vec3(${values.slice(1).map(float).join(", ")})`;

/** Wind uniform of the sail shader: x time, yz unit world wind direction (x, z), w strength 0..1. */
export const SHIP_CLOTH_UNIFORM = "uShipCloth";

export const SHIP_CLOTH_VERTEX_PARS = `
attribute vec4 ${attribute};
uniform vec4 ${SHIP_CLOTH_UNIFORM};
`;

/**
 * Replaces `#include <beginnormal_vertex>`: the cloth offset (`shipClothOffset`, added in begin_vertex)
 * and the bent normal. The wind is turned into ship space with the model matrix, so the heading,
 * pitch and roll of every craft come for free; the phase follows the craft's world position.
 * Mirrors `shipClothPoint` in ship-cloth-wind.ts.
 */
export const SHIP_CLOTH_NORMAL_VERTEX = `
#include <beginnormal_vertex>
vec3 shipClothOffset = vec3(0.0);
{
  vec3 direction = vec3(cos(${attribute}.x), 0.0, sin(${attribute}.x));
  vec3 local = transpose(mat3(modelMatrix)) * vec3(${SHIP_CLOTH_UNIFORM}.y, 0.0, ${SHIP_CLOTH_UNIFORM}.z);
  float localLength = length(local.xz);
  vec2 wind = localLength > 1e-5 ? local.xz / localLength : vec2(0.0);
  float fill = 1.0 - smoothstep(${float(luffStart)}, ${float(luffFull)}, -wind.y);
  float time = ${SHIP_CLOTH_UNIFORM}.x, strength = ${SHIP_CLOTH_UNIFORM}.w;
  float phase = dot(modelMatrix[3].xz, vec2(0.37, 0.53));
  float gust = 1.0 + sin(time * ${float(gustSlow[0])} + phase) * ${float(gustSlow[1])} +
    sin(time * ${float(gustFast[0])} + phase * 1.3) * ${float(gustFast[1])};
  float billow = (${float(luffBillow)} + ${float(1 - luffBillow)} * fill) *
    (${float(calmBillow)} + ${float(stormBillow - calmBillow)} * strength);
  float ratio = billow * gust / ${float(restBillow)};
  float along = dot(wind, direction.xz);
  vec2 lee = (wind - direction.xz * along) * ${attribute}.y * ${float(leeShift)} * strength * fill;
  vec3 waveA = ${vector(rippleA)}, waveB = ${vector(rippleB)};
  float argumentA = time * ${float(rippleA[0])} + dot(position, waveA) + phase;
  float argumentB = time * ${float(rippleB[0])} + dot(position, waveB) + phase * 1.7;
  float wave = (sin(argumentA) + 0.5 * sin(argumentB)) / 1.5;
  float amplitude = ${attribute}.z * (${float(flutterCalm)} + ${float(flutterStorm)} * strength) * (2.0 - fill);
  shipClothOffset = direction * (${attribute}.y * (ratio - 1.0) + amplitude * wave) + vec3(lee.x, 0.0, lee.y);
  float facing = dot(objectNormal, direction);
  vec3 tangential = objectNormal - direction * facing;
  vec3 slope = amplitude * (cos(argumentA) * waveA + 0.5 * cos(argumentB) * waveB) / 1.5;
  slope -= direction * dot(slope, direction);
  objectNormal = normalize(direction * facing + tangential * (1.0 + ${attribute}.w * (ratio - 1.0)) -
    facing * slope);
}
`;

export const SHIP_CLOTH_BEGIN_VERTEX = `
#include <begin_vertex>
transformed += shipClothOffset;
`;
