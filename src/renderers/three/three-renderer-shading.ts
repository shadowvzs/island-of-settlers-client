import {
  ClampToEdgeWrapping,
  DataTexture,
  type IUniform,
  LinearFilter,
  type PixelFormat,
  RedFormat,
  RGBAFormat,
  RGFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget
} from "three";

import type { EnvironmentState } from "../../render-common/environment";
import { fitTextureSize } from "../../render-common/gl-limits";
import { createGroundShaderStateForGl } from "../../render-common/ground-shader-variant";
import { getSkyLight } from "../../render-common/lighting/sky-irradiance";
import { createLiveFog } from "../../render-common/live-fog";
import { profileStep } from "../../render-common/load-profile";
import {
  createNoiseTexture,
  createWaterNormalTexture,
  NOISE_SEED,
  NOISE_TEXTURE_SIZE
} from "../../render-common/noise-textures";
import type { CoverField } from "../../render-common/props/cover-field";
import { LAWN_DEPTH_UNIFORMS, type LawnDepth } from "../../render-common/quality";
import type { RendererInput } from "../../render-common/renderer-contract";
import { createSharedUniformValues } from "../../render-common/shader-uniforms";
import { createSnowMap } from "../../render-common/snow-map";
import type { TrafficWearField } from "../../render-common/traffic-wear";
import { SHADOW_CASCADE_TILE } from "./shadow-cascades";
import { createSkyViewTexture } from "./sky-view-texture";
import { createGroundLayerTextures } from "./three-ground-layers";
import { createRuinScorchUniforms } from "./three-ground-scorch";
import {
  createAtlasTexture,
  createRepeatTexture,
  createSnowTexture,
  createThreeUniforms
} from "./three-materials";
import { createMacroNormalTexture } from "./three-rocks";
import { createSunShadows } from "./three-shadows";

type RendererShadingInput = Pick<RendererInput, "explorationFog" | "flyerAtlas" | "foliageAtlas" | "materials" |
  "microDetail" | "quality" | "seasonSnow" | "visualWinter" | "world"> & {
  gl: WebGL2RenderingContext;
  groundShaderRequest: NonNullable<RendererInput["groundShader"]>;
};

/** These textures are allocated by this island owner; shadow/refraction attachments have separate owners. */
const PRIVATE_TEXTURE_UNIFORMS = ["uCoverField", "uFlyerAtlas", "uFogMap", "uLeafAtlas", "uLeafNormals",
  "uMacroNormals", "uMicroAtlas", "uNoiseTexture", "uSkyViewLut", "uSnowMap", "uTrafficWear", "uWaterField",
  "uWaterNormals"] as const;

/** uLawnDepth of a preset: rgb meadow shade, w occlusion (off = 1,1,1,1 skips the fetch). */
export const createLawnDepthUniform = (lawnDepth: LawnDepth) =>
  new Vector4(...LAWN_DEPTH_UNIFORMS[lawnDepth]);

const createCoverFieldTexture = (
  pixels: Uint8Array, width: number, height: number, format: PixelFormat = RedFormat
) => {
  const texture = new DataTexture(pixels, width, height, format, UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

interface ShadingDisposalResources {
  albedo: Texture;
  normal: Texture;
  refraction: WebGLRenderTarget;
  shadows: { dispose: () => void };
  uniforms: Record<string, IUniform>;
}

/** Release before renderer.dispose: context loss alone does not remove texture/target dispose listeners. */
export const createRendererShadingDisposal = ({
  albedo, normal, refraction, shadows, uniforms
}: ShadingDisposalResources) => {
  // Snapshot the originally owned maps, retaining ownership if a consumer later rebinds a uniform.
  const textures = new Set<Texture>([albedo, normal]);
  for (const key of PRIVATE_TEXTURE_UNIFORMS) {
    const texture = uniforms[key]?.value as Texture | null;
    if (texture) textures.add(texture);
  }
  let disposed = false, trafficWearTexture: DataTexture | undefined;
  return {
    ownCoverField: (field: CoverField) => {
      const texture: Texture = createCoverFieldTexture(field.pixels, field.width, field.height, RGFormat);
      if (disposed) { texture.dispose(); texture.image = null; return; }
      textures.add(texture);
      uniforms.uCoverField!.value = texture;
    },
    /** One RGBA8 texture per field: later revisions re-upload the same pixels in place. */
    ownTrafficWear: (field: TrafficWearField) => {
      if (disposed) return;
      if (trafficWearTexture?.image.data === field.pixels) { trafficWearTexture.needsUpdate = true; return; }
      const texture = createCoverFieldTexture(field.pixels, field.width, field.height, RGBAFormat);
      if (trafficWearTexture) { textures.delete(trafficWearTexture); trafficWearTexture.dispose(); }
      trafficWearTexture = texture;
      textures.add(texture);
      uniforms.uTrafficWear!.value = texture;
    },
    ownWaterField: (texture: Texture) => {
      if (disposed) { texture.dispose(); texture.image = null; return; }
      textures.add(texture);
      uniforms.uWaterField!.value = texture;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) {
        texture.dispose(); texture.image = null; texture.mipmaps = [];
      }
      for (const key of PRIVATE_TEXTURE_UNIFORMS)
        if (textures.has(uniforms[key]?.value as Texture)) uniforms[key]!.value = null;
      textures.clear();
      refraction.dispose();
      shadows.dispose();
    }
  };
};

/** Shared shader uniforms, live fog, snow, sun shadows and the ground texture arrays of the island scene. */
export const createRendererShading = ({
  explorationFog,
  flyerAtlas,
  foliageAtlas,
  gl,
  groundShaderRequest,
  materials,
  microDetail,
  quality,
  seasonSnow = false,
  visualWinter = false,
  world
}: RendererShadingInput) => {
  const uniformValues = createSharedUniformValues(world);
  uniformValues.uLiveFog = 1;
  const fog = createLiveFog(world, explorationFog),
    fogTexture = createAtlasTexture(fog.pixels, fog.width, fog.height);
  const snowMap = createSnowMap(world, { seasonSnow, visualWinter });
  const shadows = createSunShadows(world, {
    cascades: quality.shadowCascadesFps,
    enabled: quality.sunShadows,
    filter: quality.shadowFilter,
    mapSize: quality.sunShadows ? fitTextureSize(gl, quality.shadowMapSize) : 1,
    maxTextureSize: fitTextureSize(gl, 2 * SHADOW_CASCADE_TILE)
  });
  const grassFade: IUniform<number> = { value: 1 };
  // Linear seabed radiance in an sRGB texture: the same 8-bit precision as the old display capture.
  const refraction = new WebGLRenderTarget(1, 1, { colorSpace: SRGBColorSpace });
  const viewport = new Vector2(1, 1);
  const skyView = quality.skyModel === "lut" ? createSkyViewTexture() : null;
  const uniforms: Record<string, IUniform> = {
    ...createThreeUniforms(uniformValues),
    uFlyerAtlas: {
      value: createAtlasTexture(flyerAtlas.pixels, flyerAtlas.size, flyerAtlas.size)
    },
    uFogMap: { value: fogTexture },
    ...shadows.uniforms,
    uGrassFade: grassFade,
    /** Cosmetic season weights (autumn, dormant, spring, monsoon) for the SEASONAL vegetation programs. */
    uSeason: { value: new Vector4(0, 0, 0, 0) },
    /** Ground season look (C1/T1, season-ground.ts): meadow tint, leaf litter, wetness, mud and snow cover. */
    uSeasonCover: { value: new Vector4(0, 0, 0, 0) },
    uSeasonLitter: { value: new Vector4(0, 0, 0, 0) },
    uSeasonMeadow: { value: new Vector4(0, 0, 0, 0) },
    uLeafAtlas: {
      value: createAtlasTexture(
        foliageAtlas.color, foliageAtlas.width, foliageAtlas.height, foliageAtlas.colorMips
      )
    },
    uLeafNormals: {
      value: createAtlasTexture(
        foliageAtlas.normal, foliageAtlas.width, foliageAtlas.height, foliageAtlas.normalMips
      )
    },
    uMacroNormals: { value: createMacroNormalTexture(world) },
    uMicroAtlas: {
      value: createAtlasTexture(
        microDetail.levels[0]!.data, microDetail.size, microDetail.size, microDetail.levels
      )
    },
    uNoiseTexture: {
      value: createRepeatTexture(createNoiseTexture(NOISE_SEED), NOISE_TEXTURE_SIZE)
    },
    uRefraction: { value: refraction.texture },
    ...(skyView ? { uSkyViewLut: { value: skyView.texture } } : {}),
    uSnowMap: { value: createSnowTexture(snowMap) },
    uWaterNormals: {
      value: createRepeatTexture(createWaterNormalTexture(NOISE_SEED), NOISE_TEXTURE_SIZE)
    },
    /** Set once its worker build arrives (before the first frame). */
    uCoverField: { value: createCoverFieldTexture(new Uint8Array([0, 0]), 1, 1, RGFormat) },
    /** Bounds of the crop plots' tilled soil (cover field G); empty until a field exists. */
    uFieldSoilBox: { value: new Vector4(1, 1, 0, 0) },
    uLawnDepth: { value: createLawnDepthUniform(quality.lawnDepth) },
    /** Presentation-only traffic wear (RG8); replaced by the source's field on its first revision. */
    uTrafficWear: { value: createCoverFieldTexture(new Uint8Array([0]), 1, 1) },
    /** Ruin scorch discs (ground and grass cover); empty until a ruin falls. */
    ...createRuinScorchUniforms(),
    uWaterField: { value: null },
    uViewport: { value: viewport }
  };
  const { albedo, normal } = profileStep("ground layer textures",
    () => createGroundLayerTextures(materials, quality.groundTileSize));
  const groundShader = createGroundShaderStateForGl(gl, groundShaderRequest, quality.groundTileSize);
  const disposal = createRendererShadingDisposal({ albedo, normal, refraction, shadows, uniforms });
  return {
    ...disposal,
    albedo, fog, fogTexture, grassFade, groundShader, normal, refraction, shadows, snowMap, uniforms, uniformValues,
    /** Refills the Medium+ sky-view texture when the shared sky light changed (no-op otherwise). */
    updateSkyView: (environment: EnvironmentState) => skyView?.update(getSkyLight(environment)),
    viewport
  };
};
