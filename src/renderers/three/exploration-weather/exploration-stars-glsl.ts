/**
 * Procedural night stars of the possessed sky (no texture, no pass). The star sphere turns about
 * a fixed celestial pole (`uStarFrame`, exploration-stars.ts). Directions are projected onto the
 * six faces of a cube and every face is cut into cells; a stable hash of the cell decides whether
 * it holds a star, where (kept inside the cell, so one cell lookup per layer suffices), how bright
 * (a steep power law: few bright, many faint) and its colour (warm, white or blue-white).
 * Each star is a Gaussian of at least 0.75 px, so it never shrinks below a pixel or shimmers when
 * the camera turns. Minimal draws the bright layer only; the other presets add a dense faint layer
 * and a faint Milky Way band. Needs EXPLORATION_SKY_DISC_GLSL first (the moon disc hides stars) and
 * the sky's uInverseProjection (the spyglass magnification).
 */

import { EXPLORATION_STARS } from "../../../render-common/atmosphere/exploration-sky-constants";

/** Cells per cube-face edge: bright layer about 1.6 degrees, faint layer about 0.56 degrees. */
export const STAR_BRIGHT_CELLS = EXPLORATION_STARS.brightCells;
export const STAR_FAINT_CELLS = EXPLORATION_STARS.faintCells;
/** Share of cells that hold a star (the faint layer is denser along the Milky Way). */
const STAR_BRIGHT_SHARE = EXPLORATION_STARS.brightShare;
const STAR_FAINT_SHARE = EXPLORATION_STARS.faintShare;
/** Twinkle angular frequencies (rad/s); the CPU wraps time at 200 pi, a whole period of both. */
const TWINKLE_FAST = EXPLORATION_STARS.twinkleFast;
const TWINKLE_SLOW = EXPLORATION_STARS.twinkleSlow;

const glslNumber = (value: number) => value.toFixed(4);

/** tan of half the possessed eye's 68-degree field of view (app/exploration/movement.ts). */
const STAR_EYE_HALF_FOV_TAN = EXPLORATION_STARS.eyeHalfFovTan;

export const EXPLORATION_STARS_GLSL = `
const float STAR_EYE_HALF_FOV_TAN = ${glslNumber(STAR_EYE_HALF_FOV_TAN)};
/** World -> star-sphere rotation about the celestial pole. */
uniform mat3 uStarFrame;
/** x visibility (night, no rain), y faint floor (moonlight), z layers (1 or 2), w time (s). */
uniform vec4 uStarParams;

vec3 starHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/** One star layer: the star of this direction's cell as display light (0 when the cell is empty). */
vec3 starLayer(
  vec3 starDirection, vec2 faceUv, vec3 faceAxis, vec3 faceU, vec3 faceV, float face,
  float cells, float share, float seed, float pixelAngle, vec2 brightness, float twinkleAmount,
  float gathering
) {
  vec2 cell = floor((faceUv * 0.5 + 0.5) * cells);
  vec3 place = starHash(vec3(cell, face * 13.0 + seed));
  if (place.x >= share) return vec3(0.0);
  vec2 starUv = (cell + 0.25 + 0.5 * place.yz) / cells * 2.0 - 1.0;
  vec3 star = normalize(faceAxis + faceU * starUv.x + faceV * starUv.y);
  vec3 look = starHash(vec3(cell.yx, face * 7.0 + seed + 101.0));
  float rank = look.x * look.x * look.x;
  rank *= rank;
  // Bright stars spread only a little wider (owner 2026-11-14: the large stars were too big); min 0.75 px.
  float sigma = max(pixelAngle * (0.75 + 0.3 * rank), 0.00001);
  vec3 offset = starDirection - star;
  float profile = exp(-dot(offset, offset) / (2.0 * sigma * sigma));
  float magnitude = brightness.x + brightness.y * rank;
  float light = max(magnitude * gathering - uStarParams.y, 0.0);
  vec3 warm = vec3(1.0, 0.86, 0.7);
  vec3 blue = vec3(0.8, 0.88, 1.0);
  vec3 tint = look.y < 0.5 ? mix(warm, vec3(1.0), look.y * 2.0) : mix(vec3(1.0), blue, look.y * 2.0 - 1.0);
  float twinkle = 1.0 + twinkleAmount * (look.z - 0.5) *
    sin(uStarParams.w * ${glslNumber(TWINKLE_FAST)} + look.z * 40.0) *
    sin(uStarParams.w * ${glslNumber(TWINKLE_SLOW)} + look.x * 23.0);
  return tint * light * profile * twinkle;
}

/** Faint diffuse Milky Way: a great-circle band with slow clumps and a darker rift. */
float starMilkyWay(vec3 starDirection) {
  float latitude = dot(starDirection, normalize(vec3(0.32, 0.55, 0.77)));
  float band = exp(-latitude * latitude / 0.05);
  float clumps = 0.65 + 0.35 * sin(starDirection.x * 9.0 + 1.3) * sin(starDirection.z * 7.0 + 0.4);
  float rift = 1.0 - 0.45 * exp(-(latitude - 0.03) * (latitude - 0.03) / 0.002);
  return band * clumps * rift;
}

/**
 * Stars and Milky Way in display light for a sky direction, behind the moon disc and dimmed near
 * the horizon (air mass), where they also twinkle a little. 'skyColor' is the display sky behind
 * them: a bright (twilight or moonlit) sky hides them. Callers add the result before the cloud
 * layers and the camera air, so clouds, overcast and the horizon veil cover them.
 */
vec3 explorationStarRadiance(vec3 direction, vec3 lightDirection, vec3 skyColor) {
  if (uStarParams.x <= 0.0 || direction.y < -0.02) return vec3(0.0);
  float skyLuma = dot(skyColor, vec3(0.299, 0.587, 0.114));
  float contrast = 1.0 - smoothstep(0.1, 0.32, skyLuma);
  float moonRadius = SKY_MOON_CHORD_RADIUS * 1.12;
  // The lit moon covers what is behind it; a new moon (not in a real night sky) hides nothing,
  // so it never shows as a dark disc against the Milky Way.
  float moonLit = smoothstep(0.0, 0.1, 0.5 * (1.0 - cos(uMoonPhase * SKY_TAU)));
  float insideMoon = step(1.0 - 0.5 * moonRadius * moonRadius, dot(direction, lightDirection));
  float outsideMoon = 1.0 - insideMoon * moonLit;
  float horizon = smoothstep(-0.02, 0.14, direction.y);
  float visible = uStarParams.x * contrast * outsideMoon * horizon;
  if (visible <= 0.0) return vec3(0.0);
  vec3 starDirection = uStarFrame * direction;
  vec3 extent = abs(starDirection);
  vec3 faceAxis;
  vec3 faceU;
  vec3 faceV;
  vec2 faceUv;
  float face;
  if (extent.x >= extent.y && extent.x >= extent.z) {
    faceAxis = vec3(sign(starDirection.x), 0.0, 0.0);
    faceU = vec3(0.0, 1.0, 0.0);
    faceV = vec3(0.0, 0.0, 1.0);
    faceUv = starDirection.yz / extent.x;
    face = starDirection.x > 0.0 ? 0.0 : 1.0;
  } else if (extent.y >= extent.z) {
    faceAxis = vec3(0.0, sign(starDirection.y), 0.0);
    faceU = vec3(1.0, 0.0, 0.0);
    faceV = vec3(0.0, 0.0, 1.0);
    faceUv = starDirection.xz / extent.y;
    face = starDirection.y > 0.0 ? 2.0 : 3.0;
  } else {
    faceAxis = vec3(0.0, 0.0, sign(starDirection.z));
    faceU = vec3(1.0, 0.0, 0.0);
    faceV = vec3(0.0, 1.0, 0.0);
    faceUv = starDirection.xy / extent.z;
    face = starDirection.z > 0.0 ? 4.0 : 5.0;
  }
  float pixelAngle = max(length(dFdx(direction)), length(dFdy(direction)));
  // Scintillation needs the long air path: only stars low over the horizon twinkle, subtly.
  float twinkleAmount = 0.6 * (1.0 - smoothstep(0.04, 0.3, direction.y));
  // The spyglass gathers more light than the eye: faint stars brighten with its magnification.
  float gathering = clamp(STAR_EYE_HALF_FOV_TAN / uInverseProjection[1][1], 1.0, 4.0);
  vec3 light = starLayer(starDirection, faceUv, faceAxis, faceU, faceV, face,
    ${glslNumber(STAR_BRIGHT_CELLS)}, ${glslNumber(STAR_BRIGHT_SHARE)}, 0.0, pixelAngle, vec2(0.12, 1.1),
    twinkleAmount, gathering);
  if (uStarParams.z > 1.5) {
    float milkyWay = starMilkyWay(starDirection);
    float share = ${glslNumber(STAR_FAINT_SHARE)} * (1.0 + 1.6 * milkyWay);
    light += starLayer(starDirection, faceUv, faceAxis, faceU, faceV, face,
      ${glslNumber(STAR_FAINT_CELLS)}, share, 57.0, pixelAngle, vec2(0.035, 0.1), twinkleAmount,
      gathering);
    light += vec3(0.82, 0.87, 1.0) * 0.1 * milkyWay * max(1.0 - uStarParams.y * 8.0, 0.0);
  }
  return light * visible;
}
`;
