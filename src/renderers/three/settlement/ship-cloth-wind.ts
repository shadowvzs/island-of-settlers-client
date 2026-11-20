import { type BufferGeometry, Float32BufferAttribute, type IUniform, type MeshStandardMaterial, Vector4,
  type WebGLProgramParametersWithUniforms } from "three";

import { SHIP_CLOTH_WIND, shipClothStrength } from "../../../render-common/ships/ship-cloth-wind";
import { SHIP_CLOTH_BEGIN_VERTEX, SHIP_CLOTH_NORMAL_VERTEX, SHIP_CLOTH_UNIFORM,
  SHIP_CLOTH_VERTEX_PARS } from "../../../render-common/ships/ship-cloth-wind-glsl";

/**
 * How sail cloth moves (SHIP-WIND, `QualityPreset.shipClothWind`): the ship layer asks it once per sail
 * geometry and sail material, and once per frame for the wind. The static strategy (Minimal) keeps the
 * authored rest shape with plain materials and no per-frame work.
 */
export interface ShipClothMotion {
  /** A sail, cloth panel or rolled-canvas geometry drawn with a sail material. */
  prepareGeometry: (geometry: BufferGeometry) => void;
  /** A sail cloth material (shared by every craft of its livery or nation). */
  prepareMaterial: (material: MeshStandardMaterial) => void;
  /** World wind as the renderer passes it: direction angle (atan2(z, x)) and speed. */
  update: (time: number, windDirection?: number, windStrength?: number) => void;
}

const { attribute, boundsMargin } = SHIP_CLOTH_WIND;

export const STATIC_SHIP_CLOTH: ShipClothMotion = {
  prepareGeometry: geometry => { geometry.deleteAttribute(attribute); },
  prepareMaterial: () => undefined,
  update: () => undefined
};

const CACHE_KEY = "ship-cloth-wind-v1";

/**
 * Vertex-shader billow and flutter: one shared uniform (time, wind direction, strength) for every sail;
 * each craft's heading comes from its model matrix, so nothing is computed per craft on the CPU.
 * Sails cast no sun shadow, so no depth twin is needed.
 */
export const createShipClothWind = (): ShipClothMotion => {
  const uniform: IUniform<Vector4> = { value: new Vector4() };
  const inject = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms[SHIP_CLOTH_UNIFORM] = uniform;
    shader.vertexShader = SHIP_CLOTH_VERTEX_PARS + shader.vertexShader
      .replace("#include <beginnormal_vertex>", SHIP_CLOTH_NORMAL_VERTEX)
      .replace("#include <begin_vertex>", SHIP_CLOTH_BEGIN_VERTEX);
  };
  const prepareGeometry = (geometry: BufferGeometry) => {
    // A rolled canvas shares the cloth material but never billows.
    if (!geometry.getAttribute(attribute))
      geometry.setAttribute(attribute, new Float32BufferAttribute(new Float32Array(
        geometry.getAttribute("position").count * 4), 4));
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius += boundsMargin;
  };
  const prepareMaterial = (material: MeshStandardMaterial) => {
    material.onBeforeCompile = inject;
    material.customProgramCacheKey = () => CACHE_KEY;
    // The node presenter finds the shared wind uniform here and attaches the TSL cloth twin.
    material.userData.shipClothWind = { uniform };
    material.needsUpdate = true;
  };
  const update = (time: number, windDirection = 0, windStrength = 0) => {
    uniform.value.set(time, Math.cos(windDirection), Math.sin(windDirection), shipClothStrength(windStrength));
  };
  return { prepareGeometry, prepareMaterial, update };
};
