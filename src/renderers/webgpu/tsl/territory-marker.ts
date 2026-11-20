import type { IUniform } from "three";
import { attribute, Discard, float, Fn, mix, normalWorld, positionWorld, vec2, vec3 } from "three/tsl";
import { type Material, MeshBasicNodeMaterial, type Texture } from "three/webgpu";

import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createPropFogHiding } from "./prop-vertex";
import { createColorTail } from "./props";
import { createTerrainLighting } from "./terrain-nodes";
import { bindScalar, bindVector, createUniformBindings, syncUniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface TerritorySource extends Material {
  defines?: Record<string, unknown>;
  uniforms?: Record<string, IUniform>;
  userData: { territoryMarker?: boolean };
}

/** `isHiddenByFog` needs the shared noise and the live fog map; absent them the stone stays visible. */
const createFogHiding = (uniforms: Record<string, IUniform> | undefined) => {
  const noiseTexture = uniforms?.uNoiseTexture?.value as Texture | undefined;
  if (uniforms === undefined || noiseTexture === undefined) return null;
  const bindings = createUniformBindings("wg4:territory-marker-fog", uniforms);
  const { valueNoise } = createNoiseNodes(noiseTexture);
  const hide = createPropFogHiding(createLiveFogSampler(bindings), valueNoise);
  return { bindings, hide };
};

/**
 * TSL twin of the territory boundary stones: the instanced vColor/playerTint mix, the stone grit
 * and the fog-of-war hiding. The lit surface uses the node standard material (the source's custom
 * `lightSurface` and the colour tail are the remaining difference, recorded in the receipt).
 */
export const createTslTerritoryMarkerMaterial = (sourceMaterial: Material): Material | null => {
  const source = sourceMaterial as TerritorySource;
  if (source.userData.territoryMarker !== true) return null;
  const fog = createFogHiding(source.uniforms);
  if (source.defines?.DEPTH_ONLY !== undefined) {
    const depth = new MeshBasicNodeMaterial({ colorWrite: false });
    depth.name = "tsl:territory-marker-depth";
    if (fog !== null) {
      depth.colorNode = Fn(() => {
        Discard(fog.hide(float(1), positionWorld.xz));
        return vec3(0);
      })() as TslNode;
      depth.userData.syncUniforms = () => syncUniformBindings(fog.bindings);
    }
    depth.userData.wg4Ported = true;
    return depth;
  }
  const noiseTexture = source.uniforms?.uNoiseTexture?.value as Texture | undefined;
  if (noiseTexture === undefined) return null;
  const bindings = createUniformBindings("wg4:territory-marker", source.uniforms ?? {});
  const player = bindVector(bindings, "uPlayerColor", 3) as TslNode;
  const tint = (attribute("playerTint", "float") as TslNode).clamp(0, 1);
  const base = mix(attribute("color", "vec3"), player, tint) as TslNode;
  const noise = createNoiseNodes(noiseTexture);
  const lighting = createTerrainLighting(bindings, source, noise.fbm3, {
    rain: bindScalar(bindings, "uRain"),
    sun: bindVector(bindings, "uSunDirection", 3) as TslNode,
    sunColor: bindVector(bindings, "uSunColor", 3) as TslNode
  });
  const colorTail = createColorTail(bindings);
  const material = new MeshBasicNodeMaterial({ depthTest: source.depthTest, depthWrite: source.depthWrite,
    side: source.side });
  material.name = "tsl:territory-marker";
  material.colorNode = Fn(() => {
    const albedo = base.toVar();
    if (fog !== null) Discard(fog.hide(float(1), positionWorld.xz));
    if (source.defines?.STONE_DETAIL === "1") {
      const grit = noise.valueNoise(positionWorld.xz.mul(91).add(positionWorld.y.mul(vec2(33, 57))));
      const patches = noise.valueNoise(positionWorld.xz.mul(12).add(positionWorld.y.mul(17)));
      albedo.assign(albedo.mul(grit.mul(0.17).add(patches.mul(0.08)).add(0.88)));
    }
    return colorTail(lighting.lightSurface(albedo, normalWorld.normalize(), float(1), float(0.94),
      positionWorld.xz));
  })() as TslNode;
  material.userData.wg4Ported = true;
  material.userData.syncUniforms = () => {
    syncUniformBindings(bindings);
    if (fog !== null) syncUniformBindings(fog.bindings);
  };
  return material;
};

export const isTerritoryMarkerMaterial = (material: Material): boolean =>
  (material as TerritorySource).userData?.territoryMarker === true;
