import { clamp, dot, float, max, mix, normalize, pow, smoothstep, vec3 } from "three/tsl";

import type { RockSurface } from "./rock-surface";
import { smoothstepDescending } from "./rock-form";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * TSL twin of `ROCK_FILL_GLSL` (`rock-glsl.ts`): the rock-only plane contrast, sky/ground fill
 * and sun specular; the material passes the real-time sun shadow (`sampleSoftRockShadow`) in.
 */
export interface RockLightInputs {
  ambientGround: TslNode;
  ambientSky: TslNode;
  highlight: TslNode;
  sunColor: TslNode;
  sunDirection: TslNode;
  viewDirection: TslNode;
}

export const createRockLightNodes = (inputs: RockLightInputs) => {
  const { ambientGround, ambientSky, highlight, sunColor, sunDirection, viewDirection } = inputs;

  /** Value push between the broad planes. */
  const getRockPlaneContrast = (rock: RockSurface, sunLit: TslNode): TslNode => {
    const lit = smoothstep(-0.1, 0.6, dot(rock.normal, sunDirection)).mul(mix(0.35, 1, sunLit));
    const push = mix(vec3(0.72, 0.75, 0.85), vec3(1.05, 1.03, 1), lit);
    const strength = float(1).sub(rock.snow.mul(0.8)).mul(float(1).sub(rock.detailed.mul(0.6)));
    return mix(vec3(1), push, strength);
  };

  /** Sky fill on upward faces and warm ground bounce on undersides. */
  const getRockFill = (albedo: TslNode, normal: TslNode, sunLit: TslNode,
    occlusion: TslNode): TslNode => {
    const shade = float(1).sub(sunLit.mul(
      clamp(dot(normal, sunDirection).mul(1.5).add(0.3), 0, 1)));
    const sky = ambientSky.mul(smoothstep(-0.3, 0.8, normal.y));
    const bounce = ambientGround.mul(vec3(1.15, 1, 0.85))
      .mul(smoothstepDescending(0.4, -0.6, normal.y));
    return albedo.mul(sky.mul(0.3).add(bounce.mul(0.4))).mul(shade)
      .mul(mix(0.6, 1, occlusion));
  };

  /** Fresh stone and damp recesses glint slightly; moss and gravel stay matte. */
  const getRockSpecular = (normal: TslNode, roughness: TslNode, sunLit: TslNode): TslNode => {
    const halfway = normalize(sunDirection.add(viewDirection));
    const gloss = float(1).sub(roughness);
    const glint = pow(max(dot(normal, halfway), 0), mix(6, 40, gloss));
    return sunColor.mul(glint).mul(gloss).mul(gloss).mul(0.6).mul(sunLit).mul(highlight);
  };

  return { getRockFill, getRockPlaneContrast, getRockSpecular };
};

/**
 * The rock material's light assembly, exactly as `three-rocks.ts` GLSL does it: shared
 * `lightSurface` on the surface normal (the detail-perturbed one), then the rock fill, the
 * roughness specular and the plane contrast. Shared with the parity bench so the wiring of the
 * assembled output is covered, not only the individual kernels.
 */
export interface RockShadingLighting {
  lightSurface(albedo: TslNode, normal: TslNode, sunVisibility: TslNode, occlusion: TslNode,
    xz: TslNode): TslNode;
}

export const createRockShadingNodes = (lighting: RockShadingLighting,
  rockLight: ReturnType<typeof createRockLightNodes>) => {
  const assembleRockShading = (albedo: TslNode, rock: RockSurface, sunLit: TslNode,
    xz: TslNode): TslNode => {
    const lit = lighting.lightSurface(albedo, rock.normal, sunLit, rock.occlusion, xz);
    return lit
      .add(rockLight.getRockFill(albedo, rock.normal, sunLit, rock.occlusion))
      .add(rockLight.getRockSpecular(rock.normal, rock.roughness, sunLit).mul(albedo))
      .mul(rockLight.getRockPlaneContrast(rock, sunLit));
  };
  return { assembleRockShading };
};
