import type { IUniform } from "three";
import { attribute, cameraProjectionMatrix, cameraViewMatrix, Discard, exp, float, Fn, mix, varying,
  vec2, vec3, vec4 } from "three/tsl";
import {
  CustomBlending, DstColorFactor, type Material, MeshBasicNodeMaterial, type Texture, ZeroFactor
} from "three/webgpu";

import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createPropFogHiding } from "./prop-vertex";
import { createAtmosphereNodes } from "./sky/atmosphere";
import { createUniformBindings, syncUniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface ContactShadowSource extends Material {
  uniforms?: Record<string, IUniform>;
  userData: { contactShadow?: boolean };
}

/** Required by `createAtmosphereNodes`; a material without them keeps the unaired strength. */
const ATMOSPHERE_UNIFORMS = [
  "uAtmosphereAirlightLinear", "uAtmosphereBankA", "uAtmosphereBankB", "uAtmosphereBankParams",
  "uAtmosphereBoundsMax", "uAtmosphereBoundsMin", "uAtmosphereEye", "uAtmosphereForward",
  "uAtmospherePass", "uAtmosphereProfile", "uAtmosphereRainbow", "uAtmosphereSun", "uAtmosphereSunTint",
  "uExplorationFog", "uLiveFog", "uWorldSize"
] as const;

const hasAtmosphereUniforms = (uniforms: Record<string, IUniform>) =>
  ATMOSPHERE_UNIFORMS.every(key => uniforms[key] !== undefined);

/**
 * TSL twin of the contact decal (three-contact-shadows.ts): a ground-multiplying plant/decoration
 * decal. The vertex expands the instanced quad in world space, the fragment darkens the ground by
 * the radial falloff and drops fog-hidden instances. The atmosphere damping uses the shared
 * surface-tau nodes, so a decal fades like the ground it multiplies.
 */
export const createTslContactShadowMaterial = (sourceMaterial: Material): Material | null => {
  const source = sourceMaterial as ContactShadowSource;
  if (source.userData.contactShadow !== true) return null;
  const uniforms = source.uniforms;
  const noiseTexture = uniforms?.uNoiseTexture?.value as Texture | undefined;
  if (uniforms === undefined || noiseTexture === undefined) return null;
  const bindings = createUniformBindings("wg4:contact-shadow", uniforms);
  const { valueNoise } = createNoiseNodes(noiseTexture);
  const hideForFog = createPropFogHiding(createLiveFogSampler(bindings), valueNoise);
  const atmosphere = hasAtmosphereUniforms(uniforms) ? createAtmosphereNodes(bindings) : null;

  const corner = attribute("corner", "vec2") as TslNode;
  const contact = attribute("contact", "vec4") as TslNode;
  const world = vec3(contact.x, contact.y, contact.z)
    .add(vec3(corner.x, 0, corner.y).mul(contact.w)).add(vec3(0, 0.05, 0)) as TslNode;
  const local = varying(corner, "vContactLocal") as TslNode;
  const worldVarying = varying(world, "vContactWorld") as TslNode;
  const fogVarying = varying(attribute("fog", "float"), "vContactFog") as TslNode;

  const material = new MeshBasicNodeMaterial({
    blending: CustomBlending,
    blendDst: ZeroFactor,
    blendSrc: DstColorFactor,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    transparent: true
  });
  material.name = "tsl:contact-shadow";
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)) as TslNode;
  material.colorNode = Fn(() => {
    const distance = local.mul(vec2(1, 1.15)).length()
      .add(valueNoise(worldVarying.xz.mul(9)).sub(0.5).mul(0.25)).toVar();
    const strength = float(1).sub(distance).clamp(0, 1).pow(1.6).toVar();
    Discard(strength.lessThan(0.01).or(hideForFog(fogVarying, worldVarying.xz)));
    if (atmosphere !== null)
      strength.assign(strength.mul(exp(atmosphere.surfaceTau(worldVarying).negate())));
    return mix(vec3(1), vec3(0.42, 0.44, 0.5), strength.mul(0.85));
  })() as TslNode;
  material.userData.wg4Ported = true;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};

export const isContactShadowMaterial = (material: Material): boolean =>
  (material as ContactShadowSource).userData?.contactShadow === true;
