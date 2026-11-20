import { type Camera, type IUniform, Vector3 } from "three";

import { rainbowReview, rainbowStrength } from "../../../render-common/atmosphere/rainbow";
import type { EnvironmentState } from "../../../render-common/environment";
import type { QualityPreset } from "../../../render-common/quality";
import type { SharedUniformValues } from "../../../render-common/shader-uniforms";
import type { WorldData } from "../../../shared/world/world-data";

const finiteUnit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const displayToLinear = (value: number) => {
  if (value <= 0.04045) return value / 12.92;
  return Math.pow((value + 0.055) / 1.055, 2.4);
};

/** Share of the airlight in-scattered as a sun lobe on a clear day, and its forward anisotropy. */
const SUN_LOBE_SHARE = 0.12;
const SUN_LOBE_G = 0.65;
/** Moonlight keeps a weaker lobe; overcast air scatters it away. */
const MOON_LOBE_FACTOR = 0.3;
const OVERCAST_LOBE_LOSS = 0.75;

const luminance = (rgb: ArrayLike<number>) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
/** Linear sun hue, refilled every frame (no allocation). */
const sunHue = new Float64Array(3);

/**
 * The direction-dependent part of the airlight (R06a): the lobe has the sun's hue at the
 * airlight's own luminance, so it shifts colour and brightness by direction without changing the
 * haze's average.
 */
const setSunLobe = (values: SharedUniformValues, environment: EnvironmentState, wet: number) => {
  const { azimuthX, azimuthZ, elevation } = environment.sun;
  const horizontal = Math.cos(elevation);
  const daylight = finiteUnit(environment.daylight);
  const lobe = values.uAtmosphereSun;
  lobe[0] = azimuthX * horizontal;
  lobe[1] = Math.sin(elevation);
  lobe[2] = azimuthZ * horizontal;
  lobe[3] = SUN_LOBE_SHARE * (daylight + (1 - daylight) * MOON_LOBE_FACTOR) * (1 - OVERCAST_LOBE_LOSS * wet);
  // Sun colours exceed 1 (display-authored light); the hue is what the lobe needs.
  for (let index = 0; index < 3; index++)
    sunHue[index] = displayToLinear(finiteUnit(environment.sunColor[index]! / 1.3));
  const tint = values.uAtmosphereSunTint;
  const scale = luminance(values.uAtmosphereAirlightLinear) / Math.max(luminance(sunHue), 1e-4);
  for (let index = 0; index < 3; index++) tint[index] = sunHue[index]! * scale;
  tint[3] = SUN_LOBE_G;
};

/**
 * The display-authored fog colour as linear light. It is not pre-graded: the shared colour output
 * grades every fogged pixel once (render-common/shaders/color-output-glsl.ts).
 */
const setAirlight = (values: SharedUniformValues, environment: EnvironmentState, wet: number) => {
  const color = environment.fogColor;
  for (let index = 0; index < 3; index++) {
    values.uAtmosphereAirlightLinear[index] = displayToLinear(finiteUnit(color[index]!));
  }
  setSunLobe(values, environment, wet);
};

/** One bounded, renderer-owned atmosphere; no GPU resources, game clock or saved state. */
export const createAtmosphereState = (
  world: Pick<WorldData, "cellsX" | "cellsZ" | "seaLevel">,
  quality: QualityPreset,
  values: SharedUniformValues
) => {
  const forward = new Vector3();
  if (import.meta.env.DEV && typeof window !== "undefined") window.__rainbow = rainbowReview;
  const margin = Math.max(1024, world.cellsX, world.cellsZ);
  const reference = Number.isFinite(world.seaLevel) ? world.seaLevel : 0;
  values.uAtmosphereBoundsMin.set([-margin, reference - 64, -margin]);
  values.uAtmosphereBoundsMax.set([world.cellsX + margin, reference + 96, world.cellsZ + margin]);
  values.uAtmosphereProfile[1] = 0.065;
  values.uAtmosphereProfile[2] = reference + 2;
  const bankRadius = Math.max(22, Math.min(56, Math.max(world.cellsX, world.cellsZ) * 0.14));
  const bankVertical = 0.34;
  const bankHeight = reference + bankRadius * bankVertical * 0.7;
  const bankDrift = bankRadius * 0.55;
  const centreX = world.cellsX * 0.5;
  const centreZ = world.cellsZ * 0.5;
  const bankA = { x: centreX - world.cellsX * 0.16, z: centreZ - world.cellsZ * 0.2 };
  const bankB = { x: centreX + world.cellsX * 0.18, z: centreZ + world.cellsZ * 0.15 };
  return {
    update: (
      camera: Camera,
      environment: EnvironmentState,
      possessed: boolean,
      blend = Number(possessed),
      time = 0
    ) => {
      const orthographic = Boolean((camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera);
      const wet = Math.max(finiteUnit(environment.rain), finiteUnit(environment.snow) * 0.65);
      // The artificial isometric camera offset is not used as an optical path length; the
      // orthographic path follows the current view span instead. Bank occupancy still uses the
      // actual eye, so a high strategic camera is not treated as being inside a ground bank.
      const strategicDensity = quality.atmosphere ? 0.00065 + wet * 0.0015 : 0;
      let density = strategicDensity;
      // Walking keeps only a light aerial-perspective haze. The old 0.007 dry density put a visible
      // white veil over owned/visible ground at the 260-unit FPS view distance. Fog-of-war and the
      // lookout/tower reveal remain the separate concealment layer, so unseen land still hides.
      if (possessed) density += (0.0016 + wet * 0.012 - density) * finiteUnit(blend);
      const cameraFar = (camera as Camera & { far?: number }).far ?? 0;
      values.uAtmosphereFar = possessed && Number.isFinite(cameraFar) ? Math.max(0, cameraFar) : 0;
      values.uAtmosphereProfile[0] = density;
      values.uAtmosphereProfile[3] = Number(orthographic);
      values.uAtmosphereEye[0] = camera.position.x;
      values.uAtmosphereEye[1] = camera.position.y;
      values.uAtmosphereEye[2] = camera.position.z;
      camera.getWorldDirection(forward);
      values.uAtmosphereForward[0] = forward.x;
      values.uAtmosphereForward[1] = forward.y;
      values.uAtmosphereForward[2] = forward.z;
      // Orthographic rays are parallel, so their fog path is the current view depth rather than
      // a fixed volume cross-section. Zooming in shortens it until clear air is genuinely clear.
      const orthoTop = (camera as Camera & { top?: number }).top ?? 0;
      const orthoBottom = (camera as Camera & { bottom?: number }).bottom ?? 0;
      const viewSpan = orthographic && Number.isFinite(orthoTop) && Number.isFinite(orthoBottom)
        ? Math.max(0, orthoTop - orthoBottom)
        : 0;
      values.uAtmosphereOrthoDepth = viewSpan > 0
        ? viewSpan / Math.max(0.25, -forward.y)
        : 0;
      values.uAtmospherePass = 1;
      const banks = quality.atmosphereBanks && !possessed;
      values.uAtmosphereBankParams[0] = banks ? 0.028 + wet * 0.012 : 0;
      values.uAtmosphereBankParams[1] = bankVertical;
      values.uAtmosphereBankParams[2] = 0.55;
      values.uAtmosphereBankParams[3] = banks ? 2 : 0;
      if (banks) {
        const seconds = Number.isFinite(time) ? time : 0;
        const driftX = Math.cos(seconds * 0.011) * bankDrift;
        const driftZ = Math.sin(seconds * 0.009) * bankDrift;
        values.uAtmosphereBankA.set([bankA.x + driftX, bankHeight, bankA.z + driftZ, bankRadius]);
        values.uAtmosphereBankB.set([
          bankB.x - driftX * 0.7,
          bankHeight + bankRadius * 0.12,
          bankB.z - driftZ * 0.7,
          bankRadius * 1.15
        ]);
      }
      setAirlight(values, environment, wet);
      // The bow belongs to the eye's view only: iso and strategic cameras never show it.
      const rainbowGate = quality.rainbow && possessed ? finiteUnit(blend) : 0;
      values.uAtmosphereRainbow = rainbowStrength(environment, rainbowGate);
    }
  };
};

/** Scoped capture/shadow exclusion. Always restore even when rendering throws. */
export const withoutAtmosphere = <T>(uniforms: Record<string, IUniform>, render: () => T): T => {
  const pass = uniforms.uAtmospherePass!;
  const previous = pass.value;
  pass.value = 0;
  try { return render(); }
  finally { pass.value = previous; }
};

declare global {
  interface Window {
    /** Development only: `force` (0..1) replaces the post-rain weather share of the bow (review). */
    __rainbow?: typeof rainbowReview;
  }
}
