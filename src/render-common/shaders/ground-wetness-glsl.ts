/**
 * Wet ground (TT-1): one material response for wet ground, applied to the GroundSample before
 * lighting. The shore swash and its damp band use it today; R14f rain wetness and RC-3 river banks
 * only need to compute their own `wetness` and call the same function.
 *
 * Wetness 0 is dry, 0.5 is saturated (fully darkened, still matte) and 1 carries a standing water
 * film (glossy, flattened relief, mirrors the sky): moist ground darkens long before it shines
 * (Lekner & Dorf 1988: water in the pores lowers the albedo; only a surface film is specular).
 * Porosity scales the darkening: sand and soil darken most, rock least.
 *
 * The albedo factor of saturated ground is the sample's wetDarken (GROUND_WET_DARKEN, 0.68: wet sand
 * reads at about 0.6–0.7 of dry sand; the sand takes its palette's own, so white sand stays light).
 * Needs the variant's GroundSample (albedo, normal, roughness, wetDarken) and the common lighting uniforms.
 * GROUND_WET_SHEEN (full ground) adds the film's sky and sun reflection; the lite ground keeps the
 * tint and the roughness only.
 */
export const GROUND_WETNESS_GLSL = `
/** Roughness of a standing water film and how far the film fills in the painted relief. */
const float WET_FILM_ROUGHNESS = 0.14;
const float WET_FILM_FLATTEN = 0.65;

/**
 * Applies wetness 0..1 to the ground sample; porosity 0..1 scales the darkening. Returns the
 * share of standing water film (0..1), which the sheen reflects.
 */
float applyGroundWetness(inout GroundSample ground, vec3 geometryNormal, float wetness, float porosity) {
  if (wetness <= 0.0) return 0.0;
  float soak = min(wetness * 2.0, 1.0) * porosity;
  float film = smoothstep(0.5, 1.0, wetness);
  ground.albedo *= mix(1.0, ground.wetDarken, soak);
  ground.roughness = mix(ground.roughness, WET_FILM_ROUGHNESS, film);
  ground.normal = normalize(mix(ground.normal, geometryNormal, film * WET_FILM_FLATTEN));
  return film;
}

#ifdef GROUND_WET_SHEEN
#ifndef GROUND_PARALLAX
uniform vec3 cameraPosition;
#endif
uniform bool isOrthographic;

/**
 * Air/water reflectance at normal incidence and the most a grazing view gets: the film is broken
 * by the grains, so it never mirrors like open water.
 */
const float WET_FILM_F0 = 0.03;
const float WET_FILM_GRAZING = 0.3;
/** Sharpness of the sun's mirror lobe on the film (wider than open water: the film is grainy). */
const float WET_SUN_SHARPNESS = 180.0;
/**
 * A swash sheet (shore-wetness-glsl.ts) is real water over the grains: it reflects like open water
 * (Schlick F0 0.02) up to this grazing share, with a sharper sun lobe.
 */
const float SWASH_SHEET_GRAZING = 0.5;
const float SWASH_SUN_SHARPNESS = 520.0;

/** Direction from the ground to the eye (per pixel in the perspective views). */
vec3 groundViewDirection(vec3 world) {
  return isOrthographic ? uViewDirection : normalize(cameraPosition - world);
}

/**
 * The film's mirror reflection (High, full ground): the R05 sky radiance in the mirrored direction
 * and a soft sun lobe, both weighted by the Schlick Fresnel. Grazing views and a low sun ahead
 * light the glossy strip; a view from above sees a faint sky sheen. The sun lobe widens with the
 * normals' screen-space variance (no sparkle aliasing at iso distance) and rolls off like the water's
 * glint, scaled by the Highlights / glare setting.
 */
vec3 getWetGroundSheen(GroundSample ground, vec2 wet, vec3 world, float sunVisibility, float occlusion) {
  float film = wet.x;
  if (film <= 0.0) return vec3(0.0);
  vec3 view = groundViewDirection(world);
  float facing = clamp(dot(ground.normal, view), 0.0, 1.0);
  float f0 = mix(WET_FILM_F0, 0.02, wet.y);
  float fresnel = f0 + (mix(WET_FILM_GRAZING, SWASH_SHEET_GRAZING, wet.y) - f0) * pow(1.0 - facing, 5.0);
  vec3 mirrored = reflect(-view, ground.normal);
  vec3 sky = skyReflection(mirrored) * occlusion * ground.occlusion;
  vec3 variance = fwidth(ground.normal);
  float spread = 1.0 + 30.0 * (variance.x + variance.y + variance.z);
  float alignment = max(dot(mirrored, uSunDirection), 0.0);
  float lobe = pow(alignment, mix(WET_SUN_SHARPNESS, SWASH_SUN_SHARPNESS, wet.y) / spread) * 2.0 / spread;
  float sunUp = smoothstep(0.0, 0.08, uSunDirection.y);
  vec3 sun = uSunColor * (lobe / (0.6 + lobe)) * sunVisibility * cloudShadow(world.xz) * sunUp * uHighlight;
  return (sky + sun) * fresnel * film;
}
#else
vec3 getWetGroundSheen(GroundSample ground, vec2 wet, vec3 world, float sunVisibility, float occlusion) {
  return vec3(0.0);
}
#endif
`;
