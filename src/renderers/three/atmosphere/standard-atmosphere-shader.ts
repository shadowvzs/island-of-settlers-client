import {
  AdditiveBlending,
  type IUniform,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderChunk,
  SpriteMaterial,
  type WebGLProgramParametersWithUniforms
} from "three";

import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from
  "../../../render-common/atmosphere/atmosphere-glsl";
import { CONCEALMENT_GLSL, CONCEALMENT_UNIFORMS_GLSL } from
  "../../../render-common/atmosphere/concealment-glsl";
import { ATMOSPHERE_VIEW_LIMIT_GLSL } from "../../../render-common/atmosphere/view-limit-glsl";
import { NEUTRAL_HIGHLIGHTS } from "../../../render-common/highlights";
import {
  COLOR_MODE_GLSL,
  COLOR_TRANSFORM_GLSL,
  STANDARD_COLOR_UNIFORMS_GLSL
} from "../../../render-common/shaders/color-output-glsl";

export const STANDARD_ATMOSPHERE_CACHE_KEY_SUFFIX = "standard-atmosphere-v1";

const STANDARD_ATMOSPHERE_MARKER = "standard-atmosphere-v1";
const WORLD_VARYING = "vAtmosphereWorld";
const PROJECT_VERTEX = "#include <project_vertex>";
const OPAQUE_FRAGMENT = "#include <opaque_fragment>";
const TONEMAPPING_FRAGMENT = "#include <tonemapping_fragment>";
const COLORSPACE_FRAGMENT = "#include <colorspace_fragment>";
const SPRITE_VIEW_POSITION = "vec4 mvPosition = modelViewMatrix[ 3 ];";
const LIGHTS_FRAGMENT_MAPS = "#include <lights_fragment_maps>";
const ENVIRONMENT_DIFFUSE = "iblIrradiance += getIBLIrradiance( geometryNormal );";
const AO_MAP_FRAGMENT = "#include <aomap_fragment>";

/**
 * Highlights / glare setting (render-common/highlights.ts): the sun's specular highlight of every
 * built-in lit material scales with `uHighlight`; diffuse and the sky reflection stay unchanged.
 */
const HIGHLIGHT_SPECULAR_GLSL = `${AO_MAP_FRAGMENT}
reflectedLight.directSpecular *= uHighlight;`;

const injectHighlightSpecular = (source: string): string =>
  source.replace(AO_MAP_FRAGMENT, HIGHLIGHT_SPECULAR_GLSL);

/**
 * Three's light-map/environment chunk without the environment diffuse: the shared SH9 sky probe
 * is the ambient of every built-in material, so the R05 sky environment adds specular only.
 */
const SPECULAR_ONLY_ENVIRONMENT_GLSL = ShaderChunk.lights_fragment_maps.replace(ENVIRONMENT_DIFFUSE, "");

const injectSpecularOnlyEnvironment = (source: string): string =>
  source.replace(LIGHTS_FRAGMENT_MAPS, SPECULAR_ONLY_ENVIRONMENT_GLSL);

const WORLD_CAPTURE_GLSL = `
vec4 standardAtmosphereLocal = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  standardAtmosphereLocal = batchingMatrix * standardAtmosphereLocal;
#endif
#ifdef USE_INSTANCING
  standardAtmosphereLocal = instanceMatrix * standardAtmosphereLocal;
#endif
${WORLD_VARYING} = ( modelMatrix * standardAtmosphereLocal ).xyz;`;

const ATMOSPHERE_FRAGMENT_PREFIX = `
#define ${STANDARD_ATMOSPHERE_MARKER.replaceAll("-", "_")}
varying vec3 ${WORLD_VARYING};
uniform float uHighlight;
${ATMOSPHERE_UNIFORMS_GLSL}
${ATMOSPHERE_GLSL}
${CONCEALMENT_UNIFORMS_GLSL}
${CONCEALMENT_GLSL}
${ATMOSPHERE_VIEW_LIMIT_GLSL}
`;

const ATMOSPHERE_COMPOSITE_GLSL = `
if ( uAtmospherePass >= 0.5 && (uAtmosphereProfile.x > 0.0 || uExplorationFog > 0.0 || uAtmosphereBankParams.w >= 0.5) ) {
  AtmosphereRay standardAtmosphereRay = atmosphereSurfaceRay( ${WORLD_VARYING} );
  float standardAtmosphereTau = atmosphereOpticalDepth( standardAtmosphereRay ) +
    concealmentOpticalDepth( standardAtmosphereRay ) + atmosphereViewLimitOpticalDepth( vAtmosphereWorld );
  outgoingLight = composeAtmosphereLinearToward( outgoingLight, standardAtmosphereTau,
    standardAtmosphereRay.direction );
}`;

/**
 * The colour contract's built-in tail. TONE_MAPPING is defined only for screen programs of a
 * contract renderer (identity CustomToneMapping) and for the HDR scene target (R10), which Three
 * compiles like the screen; other render targets keep Three's linear output. In the scene target
 * the grade waits for the frame's output pass (colorFinishOutput), and `toneMapped: false`
 * display colours are ungraded there so that pass restores them (colorDisplayOutput).
 */
const COLOR_PREFIX_GLSL = `
${STANDARD_COLOR_UNIFORMS_GLSL}
${COLOR_TRANSFORM_GLSL}
${COLOR_MODE_GLSL}
`;

const COLOR_TONE_MAP_TAIL_GLSL = `
#if defined( TONE_MAPPING )
gl_FragColor.rgb = colorToneMap( gl_FragColor.rgb );
#endif`;

const COLOR_FINISH_TAIL_GLSL = `
#if defined( TONE_MAPPING )
gl_FragColor.rgb = colorFinishOutput( gl_FragColor.rgb );
#else
gl_FragColor.rgb = colorDisplayOutput( gl_FragColor.rgb );
#endif`;

/** Shared tonemapper after Three's (identity) slot, grade and dither after its sRGB encoding. */
const injectColorOutput = (source: string): string => {
  if (!source.includes(TONEMAPPING_FRAGMENT) || !source.includes(COLORSPACE_FRAGMENT)) return source;
  return `${COLOR_PREFIX_GLSL}${source
    .replace(TONEMAPPING_FRAGMENT, `${TONEMAPPING_FRAGMENT}${COLOR_TONE_MAP_TAIL_GLSL}`)
    .replace(COLORSPACE_FRAGMENT, `${COLORSPACE_FRAGMENT}${COLOR_FINISH_TAIL_GLSL}`)}`;
};

/** The built-in shaders whose final radiance can be composed safely at the shared tail. */
export const isStandardAtmosphereMaterial = (material: Material): boolean =>
  material instanceof MeshBasicMaterial ||
  material instanceof MeshLambertMaterial ||
  material instanceof MeshPhongMaterial ||
  material instanceof MeshPhysicalMaterial ||
  material instanceof MeshStandardMaterial ||
  material instanceof SpriteMaterial;

const addWorldVarying = (source: string): string =>
  source.includes(`varying vec3 ${WORLD_VARYING};`)
    ? source
    : `varying vec3 ${WORLD_VARYING};\n${source}`;

const injectMeshWorldCapture = (source: string): string | null => {
  if (!source.includes(PROJECT_VERTEX)) return null;
  return addWorldVarying(source.replace(
    PROJECT_VERTEX,
    `${PROJECT_VERTEX}${WORLD_CAPTURE_GLSL}`
  ));
};

const injectSpriteWorldCapture = (source: string): string | null => {
  if (!source.includes(SPRITE_VIEW_POSITION)) return null;
  return addWorldVarying(source.replace(
    SPRITE_VIEW_POSITION,
    `${SPRITE_VIEW_POSITION}\n${WORLD_VARYING} = modelMatrix[ 3 ].xyz;`
  ));
};

const injectWorldCapture = (material: Material, source: string): string | null =>
  material instanceof SpriteMaterial
    ? injectSpriteWorldCapture(source)
    : injectMeshWorldCapture(source);

const injectAtmosphereComposite = (source: string, additive: boolean): string | null => {
  if (!source.includes(OPAQUE_FRAGMENT)) return null;
  return `${ATMOSPHERE_FRAGMENT_PREFIX}${source.replace(
    OPAQUE_FRAGMENT,
    `${additive ? ATMOSPHERE_COMPOSITE_GLSL.replace(
      `outgoingLight = composeAtmosphereLinearToward( outgoingLight, standardAtmosphereTau,
    standardAtmosphereRay.direction );`,
      "outgoingLight *= exp(-standardAtmosphereTau);"
    ) : ATMOSPHERE_COMPOSITE_GLSL}\n${OPAQUE_FRAGMENT}`
  )}`;
};

/**
 * Composes after skinning, morphing, displacement, instancing and batching, immediately before
 * Three writes the final colour. Unsupported/customised built-in shaders are left untouched.
 * `colorOutput` (a colour-contract renderer) also appends the shared tonemapper, grade and dither.
 */
export const applyStandardAtmosphereShader = (
  material: Material,
  uniforms: Record<string, IUniform>,
  shader: WebGLProgramParametersWithUniforms,
  colorOutput = false
): void => {
  const marker = `#define ${STANDARD_ATMOSPHERE_MARKER.replaceAll("-", "_")}`;
  if (shader.fragmentShader.includes(marker)) {
    return;
  }
  const vertexShader = injectWorldCapture(material, shader.vertexShader);
  if (!vertexShader) return;
  const fragmentShader = injectAtmosphereComposite(
    injectHighlightSpecular(injectSpecularOnlyEnvironment(shader.fragmentShader)),
    material.blending === AdditiveBlending);
  if (!fragmentShader) return;
  shader.vertexShader = vertexShader;
  shader.fragmentShader = colorOutput ? injectColorOutput(fragmentShader) : fragmentShader;
  Object.assign(shader.uniforms, uniforms);
  // Scenes whose uniform set predates the setting keep the unchanged highlights.
  shader.uniforms.uHighlight ??= { value: NEUTRAL_HIGHLIGHTS };
};
