import { COLOR_TONE_MAP_INVERSE_GLSL, COLOR_TRANSFORM_GLSL } from "./color-output-glsl";
import { FRAME_AO_APPLY_GLSL } from "./frame-ao-glsl";
import { FRAME_GOD_RAYS_APPLY_GLSL } from "./frame-god-rays-glsl";
import { FRAME_WATER_REFLECTION_APPLY_GLSL } from "./frame-water-reflection-glsl";

/**
 * GLSL of the frame compositor's output pass (R10, renderers/three/frame-compositor.ts), one
 * fullscreen triangle, GLSL ES 3.00. The canvas alpha is the scene's (alpha-to-coverage foliage
 * keeps writing its coverage, exactly as it did into the canvas).
 */

/**
 * R12b: the ambient occlusion of the output passes, compiled only with FRAME_AO (the compositor's
 * AO variants); the occlusion-only debug view replaces the pixel by its visibility grey.
 */
const FRAME_AO_CHUNK_GLSL = `#ifdef FRAME_AO
${FRAME_AO_APPLY_GLSL}
#endif`;

/**
 * R18b: the screen-space water reflection of the output passes, compiled only with
 * FRAME_WATER_REFLECTION; it blends into the scene colour before any other output work.
 */
const FRAME_WATER_REFLECTION_CHUNK_GLSL = `#ifdef FRAME_WATER_REFLECTION
${FRAME_WATER_REFLECTION_APPLY_GLSL}
#endif`;

/** R06c: the possessed sun shafts of the linear output pass, compiled only with FRAME_GOD_RAYS. */
const FRAME_GOD_RAYS_CHUNK_GLSL = `#ifdef FRAME_GOD_RAYS
${FRAME_GOD_RAYS_APPLY_GLSL}
#endif`;

/** The scene pixel with the water reflection blended in (R18b variants), else unchanged. */
const SCENE_FETCH_GLSL = `
vec4 fetchScene(ivec2 pixel) {
  vec4 scene = texelFetch(uScene, pixel, 0);
#ifdef FRAME_WATER_REFLECTION
  scene.rgb = frameWaterReflection(pixel, scene.rgb);
#endif
  return scene;
}`;

export const FRAME_TRIANGLE_VERTEX_GLSL = `precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** The RGBA8 target holds every material's final display pixel: the pass is a copy. */
export const FRAME_COPY_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
out vec4 fragColor;
${FRAME_AO_CHUNK_GLSL}
${FRAME_WATER_REFLECTION_CHUNK_GLSL}
${SCENE_FETCH_GLSL}
void main() {
  fragColor = fetchScene(ivec2(gl_FragCoord.xy));
#ifdef FRAME_AO
  float visibility = frameAoVisibility(ivec2(gl_FragCoord.xy), fragColor.a);
  fragColor = vec4(frameAoDisplay(frameAoDebugView() ? vec3(1.0) : fragColor.rgb, visibility), 1.0);
#endif
}`;

/**
 * The RGBA16F target holds every fragment's tonemapped, sRGB-encoded colour before the grade
 * (COLOR_MODE_GLSL), so the pass grades and dithers each pixel once; a post pass that needs linear
 * radiance (R11 bloom and exposure, R12 GTAO) inverts the tonemapper here before it and tonemaps
 * again after it.
 */
export const FRAME_OUTPUT_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
uniform float uColorGradeRain;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
uniform float toneMappingExposure;
out vec4 fragColor;
${COLOR_TRANSFORM_GLSL}
${FRAME_AO_CHUNK_GLSL}
${FRAME_WATER_REFLECTION_CHUNK_GLSL}
${SCENE_FETCH_GLSL}
void main() {
  vec4 scene = fetchScene(ivec2(gl_FragCoord.xy));
  fragColor = vec4(colorFinishDisplay(scene.rgb), scene.a);
#ifdef FRAME_AO
  float visibility = frameAoVisibility(ivec2(gl_FragCoord.xy), scene.a);
  fragColor = vec4(frameAoDisplay(frameAoDebugView() ? vec3(1.0) : fragColor.rgb, visibility), 1.0);
#endif
}`;

/**
 * The linear output pass (R11a): recovers linear radiance from the scene target, lets post passes
 * add light (`uBloom`, its texture null and intensity 0 until R11b), then tonemaps, grades and
 * dithers once; the possessed eye scales the radiance by its adapted exposure (R11c, `uExposureWeight`
 * 0 elsewhere). With no post pass the compositor keeps FRAME_OUTPUT_FRAGMENT_GLSL / the copy and
 * this pass is never drawn, so the frame stays pixel-identical. The compositor defines
 * COLOR_SCENE_GRADED for rgba8, whose target holds the graded display pixel.
 */
export const FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomTexture;
uniform sampler2D uExposureTexture;
uniform float uBloom;
uniform float uExposureWeight;
uniform float uColorGradeRain;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
uniform float toneMappingExposure;
out vec4 fragColor;
${COLOR_TRANSFORM_GLSL}
${COLOR_TONE_MAP_INVERSE_GLSL}
${FRAME_AO_CHUNK_GLSL}
${FRAME_GOD_RAYS_CHUNK_GLSL}
${FRAME_WATER_REFLECTION_CHUNK_GLSL}
${SCENE_FETCH_GLSL}
void main() {
  vec4 scene = fetchScene(ivec2(gl_FragCoord.xy));
  vec3 linear = colorSceneToLinear(scene.rgb);
#ifdef FRAME_AO
  float visibility = frameAoVisibility(ivec2(gl_FragCoord.xy), scene.a);
  if (frameAoDebugView()) {
    fragColor = vec4(frameAoDisplay(vec3(1.0), visibility), 1.0);
    return;
  }
  linear *= visibility;
  scene.a = 1.0;
#endif
#ifdef FRAME_GOD_RAYS
  linear = frameGodRays(linear, ivec2(gl_FragCoord.xy));
#endif
  linear += uBloom * texture(uBloomTexture, gl_FragCoord.xy / vec2(textureSize(uScene, 0))).rgb;
  // R11c: the possessed eye's adapted EV, faded in by the possession weight; 0 skips it (bit-identical).
  if (uExposureWeight > 0.0) linear *= exp2(uExposureWeight * texelFetch(uExposureTexture, ivec2(0), 0).r);
  fragColor = vec4(colorFinishDisplay(colorSrgbEncode(colorToneMap(linear))), scene.a);
}`;
