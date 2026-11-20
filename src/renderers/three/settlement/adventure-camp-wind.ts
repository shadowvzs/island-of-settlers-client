import { type MeshStandardMaterial,Vector2 } from "three";

export const CAMP_CLOTH_MAX_DISPLACEMENT = .18;

/** Ridges, poles, ropes and ground hems have zero freedom; only authored fabric can move. */
export const attachAdventureCampWind = (material: MeshStandardMaterial) => {
  const uniforms = { campWindTime: { value: 0 }, campWindStrength: { value: 0 },
    campWindVector: { value: new Vector2(1, 0) } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float campWind;
      attribute float campFabric;
      attribute float campWood;
      varying float vCampWood;
      varying vec2 vCampWoodUv;
      varying float vCampFabric;
      uniform float campWindTime;
      uniform float campWindStrength;
      uniform vec2 campWindVector;
      ${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vCampFabric = campFabric;
      vCampWood = campWood; vCampWoodUv = uv;
      float gust = sin(campWindTime * 1.15 + position.x * .43 + position.z * .36);
      float flutter = sin(campWindTime * 3.6 + position.z * 2.4 + position.x * 1.6);
      float freedom = clamp(campWind, 0.0, 1.0) * campWindStrength;
      transformed.xz += campWindVector * (.055 + .06 * gust + .02 * flutter) * freedom;
      transformed.y += .014 * sin(campWindTime * 2.0 + position.z) * freedom;
    `);
    // Keep woven normal/albedo on canvas while structural wood and stone retain vertex grain.
    shader.fragmentShader = `varying float vCampFabric;
varying float vCampWood;
varying vec2 vCampWoodUv;
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
      `vec3 campUnmappedColor = diffuseColor.rgb;
#include <map_fragment>
diffuseColor.rgb = mix(campUnmappedColor, diffuseColor.rgb, vCampFabric);
// Original analytic wood: no texture fetch, geometry expansion or grain on canvas/rope/metal.
if (vCampWood > .5) {
  float weathering = .975 + .025 * sin(vCampWoodUv.x * 43.98 + vCampWoodUv.y * .9);
  float grain = 1.0;
  if (vCampWood > 1.5) {
    vec2 cut = vCampWoodUv * 2.0 - 1.0;
    float radius = length(cut);
    float grainVisibility = 1.0 - smoothstep(.25, .75, fwidth(radius) * 4.14);
    grain -= .075 * (.5 + .5 * sin(radius * 26.0)) * grainVisibility;
  } else {
    float grainVisibility = 1.0 - smoothstep(.25, .75, fwidth(vCampWoodUv.x) * 28.0);
    float fibres = sin(vCampWoodUv.x * 175.93 + .65 * sin(vCampWoodUv.y * 9.0 + vCampWoodUv.x * 3.0));
    grain -= .085 * smoothstep(.65, .98, fibres) * grainVisibility;
  }
  diffuseColor.rgb *= grain * weathering;
}`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>",
      `vec3 campBaseNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(campBaseNormal, normal, vCampFabric));`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
roughnessFactor = mix(roughness, roughnessFactor, vCampFabric);`);
  };
  material.customProgramCacheKey = () => "adventure-camp-cloth-wind-wood-v3";
  return { uniforms, update: (time: number, windX: number, windZ: number) => {
    uniforms.campWindTime.value = time;
    const strength = Math.hypot(windX, windZ);
    uniforms.campWindStrength.value = Math.min(1.2, strength);
    uniforms.campWindVector.value.set(windX, windZ).normalize();
  } };
};
