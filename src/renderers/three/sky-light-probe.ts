import { LightProbe } from "three";

import type { EnvironmentState } from "../../render-common/environment";
import { getSkyLight } from "../../render-common/lighting/sky-irradiance";

/**
 * The fitted ambient intensity of the built-in light rigs (formerly HemisphereLight 1.8). A Three
 * light probe returns irradiance E and Lambert divides it by π, while the hemisphere's colour was
 * the irradiance itself; 1.8 / π keeps every up- and down-facing built-in surface unchanged.
 */
export const BUILT_IN_AMBIENT_INTENSITY = 1.8 / Math.PI;

/**
 * The shared SH9 sky light (R05) for built-in materials: the same projection raw shaders use,
 * copied into the probe only when it changed.
 */
export const createSkyLightProbe = () => {
  const probe = new LightProbe(undefined, BUILT_IN_AMBIENT_INTENSITY);
  probe.name = "sky-light-probe";
  let revision = -1;
  const update = (environment: EnvironmentState) => {
    const sky = getSkyLight(environment);
    if (sky.revision === revision) return;
    revision = sky.revision;
    probe.sh.fromArray(sky.radiance);
  };
  return { probe, update };
};
