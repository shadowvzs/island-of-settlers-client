import { exp } from "three/tsl";

import { WATER_DEPTH_ENCODING } from "../../../render-common/water-field";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** TSL twin of `decodeWaterDepth` (water-field.ts): signed depth of the field's asinh-encoded red. */
export const decodeTslWaterDepth = (encoded: TslNode): TslNode => {
  const scaled = encoded.mul(WATER_DEPTH_ENCODING.range).add(WATER_DEPTH_ENCODING.min) as TslNode;
  return exp(scaled).sub(exp(scaled.negate())).mul(WATER_DEPTH_ENCODING.softness * 0.5);
};
