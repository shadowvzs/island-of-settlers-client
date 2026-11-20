import type { IUniform } from "three";
import { float, Fn, mix, positionLocal, screenCoordinate, texture, uniform, varying, vec4 } from "three/tsl";
import { type Material, MeshBasicNodeMaterial, type Texture } from "three/webgpu";

import { exposureForWeight } from "../../../render-common/color-output";
import type { SeasonClass } from "../../../render-common/seasonal-appearance/season-palettes";
import { colorFinishDisplay, colorSrgbDecode, colorSrgbEncode, colorToneMap } from "./color-output";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createSeasonFoliage, createSeasonPick } from "./prop-season";
import { createPropSurface } from "./prop-surface";
import { createPropFogHiding, createPropVertex } from "./prop-vertex";
import { createWinterNodes, foliageKindOf } from "./prop-winter";
import { sunShadowAt } from "./sun-shadow";
import { createTerrainLighting } from "./terrain-nodes";
import {
  bindComputed,
  bindScalar,
  bindVector,
  createUniformBindings,
  syncUniformBindings,
  type UniformBindings
} from "./uniform-bindings";
import { createWindNodes } from "./wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface PropSource {
  defines?: Record<string, unknown>;
  fragmentShader?: string;
  uniforms?: Record<string, IUniform>;
  vertexShader?: string;
}

/**
 * The prop vertex applies the instance matrix itself (after the prop-space sway, before the
 * world wind), so Three's automatic instancing transform must not run first.
 */
export class PropNodeMaterial extends MeshBasicNodeMaterial {
  override setupPosition() {
    return positionLocal;
  }
}

/** The colour prop material of three-prop-materials (not its sun-depth twin). */
export const isPropMaterial = (material: Material) => {
  const { fragmentShader, uniforms, vertexShader } = material as PropSource;
  return uniforms?.uIsGrass !== undefined && uniforms.uLeafAtlas !== undefined &&
    vertexShader?.includes("instanceTint") === true && fragmentShader?.includes("lightPropSurface") === true;
};

/**
 * SURFACE_COLOR_OUTPUT_GLSL `finishSurface` without the camera air (not ported yet): display colour
 * -> linear -> exposure + tonemap -> sRGB -> grade + dither. The node renderer encodes the canvas,
 * so the finished display colour is handed over in linear light.
 */
export const createColorTail = (bindings: UniformBindings) => {
  const toneWeight = bindScalar(bindings, "uColorToneMapper", 0);
  const exposure = bindComputed(bindings, () =>
    exposureForWeight(Number(bindings.source.uColorToneMapper?.value ?? 0)));
  const gradeRain = bindScalar(bindings, "uColorGradeRain", 0);
  const vividBoost = bindScalar(bindings, "uColorVividBoost", 0);
  return (color: TslNode): TslNode => {
    const display = colorSrgbEncode(colorToneMap(colorSrgbDecode(color), exposure, toneWeight));
    return colorSrgbDecode(colorFinishDisplay(display, screenCoordinate.xy, gradeRain, vividBoost, toneWeight));
  };
};

/** 1 while the drawn camera is orthographic (the eye ray is then the view direction). */
const createOrthographicFlag = (): TslNode => uniform(0).onRenderUpdate(({ camera }) =>
  ((camera as { isOrthographicCamera?: boolean } | null)?.isOrthographicCamera ? 1 : 0));

const createPropNodes = (bindings: UniformBindings, source: PropSource, noiseTexture: Texture) => {
  const isGrass = (source.uniforms!.uIsGrass!.value as number) > 0.5;
  const { fbm3, valueNoise } = createNoiseNodes(noiseTexture);
  const liveFog = createLiveFogSampler(bindings);
  const sources = createPropVertex({
    bindings, choppable: source.defines?.PROP_CHOP !== undefined, isGrass, liveFog,
    seasonSnow: source.defines?.SEASON_SNOW !== undefined && source.defines?.GRASS_COVER !== undefined,
    springBloom: source.defines?.SPRING_BLOOM !== undefined, valueNoise,
    wind: createWindNodes(valueNoise)
  });
  const world = varying(sources.world, "vWorld") as TslNode;
  const instance = varying(sources.instance, "vInstance") as TslNode;
  const rain = bindScalar(bindings, "uRain");
  const sunDirection = bindVector(bindings, "uSunDirection", 3);
  const sunColor = bindVector(bindings, "uSunColor", 3);
  const viewDirection = bindVector(bindings, "uViewDirection", 3);
  const lighting = createTerrainLighting(bindings, source as Material, fbm3,
    { rain, sun: sunDirection, sunColor });
  const surface = createPropSurface({
    ambient: bindVector(bindings, "uAmbientSky", 3).add(bindVector(bindings, "uAmbientGround", 3)),
    highlight: bindScalar(bindings, "uHighlight"),
    leafNormals: source.uniforms!.uLeafNormals!.value as Texture,
    lightSurface: lighting.lightSurface,
    orthographic: createOrthographicFlag(),
    sunColor, sunDirection, valueNoise, viewDirection
  });
  // P33: one Fn stack, so the leaf atlas test and sample pinned in `shadeLeaf` are assigned before the
  // surface branches; built first inside a branch, the coverage line read them unset (leaves cut out).
  const color = Fn(() => {
    const leafUv = varying(sources.uv, "vUv") as TslNode;
    const leaf = surface.shadeLeaf(texture(source.uniforms!.uLeafAtlas!.value as Texture, leafUv),
      varying(sources.color, "vColor"), (varying(sources.normal, "vNormal") as TslNode).normalize(),
      leafUv, world);
    if (source.defines?.SEASONAL !== undefined) {
      const pick = varying(createSeasonPick(sources.position, sources.phase, valueNoise), "vSeasonPick");
      const season = createSeasonFoliage(bindings, source.uniforms!.uSeasonClass!.value as SeasonClass,
        valueNoise)(leaf.albedo, leafUv, pick);
      leaf.albedo = season.albedo;
      leaf.coverage = leaf.coverage.mul(season.keep);
    }
    if (source.defines?.WINTER !== undefined && source.uniforms!.uSnowMap?.value) {
      const winter = createWinterNodes(source.uniforms!.uSnowMap.value as Texture, valueNoise);
      const kind = foliageKindOf(leafUv) as TslNode;
      const snow = winter.snowAt(world.xz) as TslNode;
      const load = source.defines?.SEASON_SNOW !== undefined
        ? winter.seasonLoadAt(world, snow, bindVector(bindings, "uSeasonCover", 4)) : snow;
      leaf.albedo = winter.apply(leaf.albedo, kind, snow, leaf.normal, world, load) as TslNode;
      leaf.coverage = leaf.coverage.mul(winter.keep(kind, snow, world)) as TslNode;
    }
    const sunVisibility = mix(1, instance.x, bindScalar(bindings, "uBakedShadowWeight"))
      .mul(sunShadowAt(source.uniforms, world));
    const lit = surface.lightSurfaceOf(leaf.albedo, leaf.normal, leafUv, world, sunVisibility);
    const fog = createFogNodes({ fbm3, liveFog, noiseTexture });
    const fogged = fog.applyFogOfWar(lit, instance.y, world.xz, bindVector(bindings, "uWorldSize", 2),
      bindScalar(bindings, "uTime"), bindScalar(bindings, "uExplorationFog"),
      bindScalar(bindings, "uFogOfWarLit"), bindVector(bindings, "uFogColor", 3), rain,
      viewDirection, sunDirection, sunColor);
    // GRASS_COVER hides tufts in the vertex stage; other props dissolve per fragment.
    const coverage = isGrass ? leaf.coverage
      : createPropFogHiding(liveFog, valueNoise)(instance.y, world.xz).select(float(0), leaf.coverage);
    return vec4(createColorTail(bindings)(fogged), coverage);
  })();
  return { clip: sources.clip, color, isGrass };
};

/**
 * TSL twin of the instanced prop material (trees, bushes, grass tufts, placed and felled props):
 * the PROP_VERTEX_GLSL vertex contract and the PROP_FRAGMENT_GLSL surface, fog-of-war and colour
 * tail. Not ported yet (see the receipt): the WINTER leaf/snow branch, the shell surfaces and the
 * camera air.
 */
export const createTslPropMaterial = (sourceMaterial: Material): Material | null => {
  if (!isPropMaterial(sourceMaterial)) return null;
  const source = sourceMaterial as PropSource;
  const noiseTexture = source.uniforms!.uNoiseTexture?.value as Texture | undefined;
  if (!noiseTexture || !source.uniforms!.uLeafNormals?.value) return null;
  const bindings = createUniformBindings("prop", source.uniforms!);
  const { clip, color, isGrass } = createPropNodes(bindings, source, noiseTexture);
  const material = new PropNodeMaterial({
    alphaTest: isGrass ? 0 : 0.5,
    alphaToCoverage: !isGrass,
    depthTest: sourceMaterial.depthTest,
    depthWrite: sourceMaterial.depthWrite,
    side: sourceMaterial.side
  });
  material.name = "wg:prop";
  material.colorNode = color;
  material.vertexNode = clip;
  material.toneMapped = false;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};
