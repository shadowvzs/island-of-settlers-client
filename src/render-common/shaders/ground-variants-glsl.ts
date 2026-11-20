import type { GroundShaderVariant } from "../ground-shader-variant";
import { GROUND_GLSL } from "./ground-glsl";
import { GROUND_LITE_GLSL } from "./ground-lite-glsl";

/** Ground GLSL per variant (same functions: sampleGround, lightGround). */
export const GROUND_VARIANT_GLSL: Record<GroundShaderVariant, string> = {
  full: GROUND_GLSL,
  lite: GROUND_LITE_GLSL
};
