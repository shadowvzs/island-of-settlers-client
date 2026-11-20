import { DoubleSide, type IUniform, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking, ShaderChunk,
  Vector2, Vector3, type WebGLProgramParametersWithUniforms } from "three";

import { FOLIAGE_ATLAS_ALPHA_CUTOFF,
  type FoliageAtlasTile } from "../../../render-common/plants/foliage-atlas-layout";
import { SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORM_NAMES } from "../three-shadows";
import type { FoliageAtlasMaps } from "./foliage-atlas-loader";

/** Back-light weight of the translucency term (card D04b): High, Minimal. */
export const DECORATION_FOLIAGE_TRANSLUCENCY = Object.freeze({ high: .22, minimal: .12 });

export interface DecorationFoliageMaterialOptions {
  /** MSAA is on: sharpened alpha-to-coverage edges instead of a hard alpha test. */
  antialias: boolean;
  /** Low/Medium/High (`!quality.liteGround`): normal map, sun shadows, wind and underside tint. */
  detailed: boolean;
  maps: FoliageAtlasMaps;
  /**
   * Ground cover (road verges): both faces keep the authored sky-leaning normal instead of the
   * back face flipping it, so a card seen from behind is lit like the meadow, not like its underside.
   */
  skyLit?: boolean;
  tiles: readonly FoliageAtlasTile[];
  /** Shared renderer uniforms (sun, wind, time, shadow map); review/icon scenes may omit them. */
  uniforms?: Record<string, IUniform>;
}

/** Flower parts that hold together and barely move (petals, calyx, heads, umbels, seed spikes). */
const STIFF_TILE = /petal|calyx|head|umbel|spike|flower/;

/** Flutter strength per tile: leaves sway, flower parts stay together, empty tiles never move. */
const tileFlutter = (tile: FoliageAtlasTile) => {
  if (tile.coverage <= 0) return 0;
  return STIFF_TILE.test(tile.id) ? .3 : 1;
};

/** Pivot (xy, tile UV) and flutter weight (z) per atlas tile, read by the vertex wind. */
const tilePivotUniform = (tiles: readonly FoliageAtlasTile[]) => ({
  value: Array.from({ length: 16 }, (_, index) => {
    const tile = tiles.find(entry => entry.index === index);
    return tile ? new Vector3(tile.pivot[0], tile.pivot[1], tileFlutter(tile)) : new Vector3();
  })
});

/** Island-free scenes (icons, reviews) keep a fixed noon sun, no wind and no shadow map. */
const fallbackUniforms = (): Record<string, IUniform> => ({
  uSunColor: { value: new Vector3(1, .96, .9) },
  uSunDirection: { value: new Vector3(-.42, .78, .46).normalize() },
  uSunShadows: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: new Vector2() }
});

/** The named shared uniforms (or the island-free fallback); a name neither provides is left out. */
const shared = (uniforms: Record<string, IUniform> | undefined, names: readonly string[]) => {
  const fallback = fallbackUniforms();
  return Object.fromEntries(names.flatMap(name => {
    const uniform = uniforms?.[name] ?? fallback[name];
    return uniform ? [[name, uniform]] : [];
  }));
};

const VERTEX_PARS = `
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uFoliagePivots[16];
#ifdef DECORATION_FOLIAGE_SHADOWS
varying vec3 vFoliageWorld;
#endif
/** 0 at the card's attachment pivot, 1 at its far edge, scaled per tile (petals barely move). */
float foliageFlutterWeight(vec2 atlasUv) {
  vec2 cell = clamp(floor(atlasUv * 4.0), 0.0, 3.0);
  vec3 pivot = uFoliagePivots[int(cell.y * 4.0 + cell.x)];
  return clamp(length(atlasUv * 4.0 - cell - pivot.xy) * 1.6, 0.0, 1.0) * pivot.z;
}
`;

/** Leaf flutter about the attachment (calm air stays almost still); canes and frames never move. */
const VERTEX_WIND = `
#include <begin_vertex>
#ifdef DECORATION_FOLIAGE_WIND
{
  float foliageFlutter = foliageFlutterWeight(uv);
  vec3 foliageAnchor = vec3(0.0);
#ifdef USE_INSTANCING
  foliageAnchor = instanceMatrix[3].xyz;
#endif
  float foliagePhase = dot(foliageAnchor.xz, vec2(2.2, 1.4));
  transformed += vec3(
    sin(uTime * 11.0 + foliagePhase * 3.0 + position.y * 11.0),
    sin(uTime * 9.4 + foliagePhase + position.x * 9.0) * 0.5,
    cos(uTime * 12.3 + foliagePhase * 2.0 + position.z * 13.0)
  ) * 0.012 * (0.15 + length(uWind)) * foliageFlutter;
}
#endif
`;

const VERTEX_WORLD = `
#include <project_vertex>
#ifdef DECORATION_FOLIAGE_SHADOWS
#ifdef USE_INSTANCING
vFoliageWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vFoliageWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
#endif
`;

const FRAGMENT_PARS = (translucency: number) => `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
const float FOLIAGE_TRANSLUCENCY = ${translucency.toFixed(3)};
#ifdef DECORATION_FOLIAGE_SHADOWS
varying vec3 vFoliageWorld;
${SUN_SHADOW_GLSL}
#endif
`;

/** ORM B = how much of the card's vertex tint applies; baked natural parts keep their colour. */
const FRAGMENT_COLOR = `
vec4 foliageOrm = texture2D( roughnessMap, vRoughnessMapUv );
#if defined( USE_COLOR )
diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, foliageOrm.b );
#endif
#ifdef DECORATION_FOLIAGE_UNDERSIDE
if ( !gl_FrontFacing ) {
  float foliageLeafy = clamp( ( diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) ) * 6.0, 0.0, 1.0 );
  float foliageGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( foliageGrey ) * 1.2, 0.2 * foliageLeafy );
}
#endif
`;

/** Sun shadow at the instance's real position, then light through thin tissue from behind. */
const FRAGMENT_LIGHT = `
#include <lights_fragment_end>
#ifdef DECORATION_FOLIAGE_SHADOWS
float foliageSun = sampleSunShadow( vFoliageWorld );
reflectedLight.directDiffuse *= foliageSun;
reflectedLight.directSpecular *= foliageSun;
#else
float foliageSun = 1.0;
#endif
vec3 foliageSunView = normalize( ( viewMatrix * vec4( uSunDirection, 0.0 ) ).xyz );
float foliageDay = smoothstep( 0.0, 0.2, uSunDirection.y ) * mix( 0.3, 1.0, smoothstep( 0.15, 0.5, uSunDirection.y ) );
reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * foliageOrm.r * foliageSun * foliageDay *
  max( dot( -normal, foliageSunView ), 0.0 ) * FOLIAGE_TRANSLUCENCY;
`;

const extendVertex = (shader: WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = VERTEX_PARS + shader.vertexShader
    .replace("#include <begin_vertex>", VERTEX_WIND)
    .replace("#include <project_vertex>", VERTEX_WORLD);
};

export const decorationFoliageCacheKey = (antialias: boolean, detailed: boolean, skyLit = false) =>
  `decoration-foliage-v1:${antialias ? "a2c" : "test"}:${detailed ? "high" : "minimal"}${skyLit ? ":sky" : ""}`;

/** The stock normal chunk without the back-face flip (see `skyLit`). */
const SKY_LIT_NORMAL = ShaderChunk.normal_fragment_begin.replace("gl_FrontFacing ? 1.0 : - 1.0", "1.0");

const foliageDefines = (detailed: boolean, shadows: boolean): Record<string, string> => detailed
  ? { DECORATION_FOLIAGE_UNDERSIDE: "", DECORATION_FOLIAGE_WIND: "", ...shadows ? { DECORATION_FOLIAGE_SHADOWS: "" } : {} }
  : {};

/** Depth twin for future sun-shadow casting (R02): same cut-out and the same leaf flutter. */
const createFoliageDepthMaterial = (options: DecorationFoliageMaterialOptions,
  vertexUniforms: Record<string, IUniform>) => {
  const depth = new MeshDepthMaterial({ alphaTest: FOLIAGE_ATLAS_ALPHA_CUTOFF, depthPacking: RGBADepthPacking,
    map: options.maps.albedo, side: DoubleSide });
  depth.defines = foliageDefines(options.detailed, false);
  depth.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, vertexUniforms);
    extendVertex(shader);
  };
  depth.customProgramCacheKey = () => `${decorationFoliageCacheKey(false, options.detailed)}:depth`;
  return depth;
};

export interface DecorationFoliageMaterials {
  /** Assign as the foliage mesh's `customDepthMaterial` (cut-out + flutter for future casting). */
  depth: MeshDepthMaterial;
  dispose(): void;
  material: MeshStandardMaterial;
}

/**
 * The one decoration leaf/petal material of a detail level (card D04b): atlas albedo + coverage
 * cut-out (alpha-to-coverage under MSAA), High normal map, ORM roughness/tint strength, back-light
 * translucency, instanced sun-shadow receive and High-only leaf flutter. No transmission pass.
 * Leased atlas textures are borrowed: `dispose` frees only the two materials.
 */
export const createDecorationFoliageMaterial = (options: DecorationFoliageMaterialOptions):
DecorationFoliageMaterials => {
  const { antialias, detailed, maps } = options;
  const shadows = detailed && Boolean(options.uniforms?.uShadowMap);
  const material = new MeshStandardMaterial({
    alphaTest: FOLIAGE_ATLAS_ALPHA_CUTOFF,
    alphaToCoverage: antialias,
    map: maps.albedo,
    metalness: 0,
    normalMap: detailed ? maps.normal : null,
    roughness: 1,
    roughnessMap: maps.orm,
    side: DoubleSide,
    vertexColors: true
  });
  material.name = "decoration-foliage";
  material.defines = foliageDefines(detailed, shadows);
  const vertexUniforms = { ...shared(options.uniforms, ["uTime", "uWind"]), uFoliagePivots: tilePivotUniform(options.tiles) };
  const fragmentUniforms = shared(options.uniforms, ["uSunColor", "uSunDirection"]);
  const shadowUniforms = shadows ? shared(options.uniforms, SUN_SHADOW_UNIFORM_NAMES) : {};
  const translucency = DECORATION_FOLIAGE_TRANSLUCENCY[detailed ? "high" : "minimal"];
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, vertexUniforms, fragmentUniforms, shadowUniforms);
    extendVertex(shader);
    if (options.skyLit) shader.fragmentShader = shader.fragmentShader
      .replace("#include <normal_fragment_begin>", SKY_LIT_NORMAL);
    shader.fragmentShader = FRAGMENT_PARS(translucency) + shader.fragmentShader
      .replace("#include <color_fragment>", FRAGMENT_COLOR)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * foliageOrm.g;")
      .replace("#include <lights_fragment_end>", FRAGMENT_LIGHT);
  };
  const key = decorationFoliageCacheKey(antialias, detailed, options.skyLit);
  material.customProgramCacheKey = () => key;
  const depth = createFoliageDepthMaterial(options, vertexUniforms);
  return { depth, material, dispose: () => { depth.dispose(); material.dispose(); } };
};
