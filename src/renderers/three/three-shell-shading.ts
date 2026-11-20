import { SHELL_PATTERN_STRIDE } from "../../render-common/props/shells/shell-surface";
import { glslFloat } from "../../render-common/shaders/common-glsl";
import { BARK_FAMILY } from "../../render-common/trees/bark-uv";

/**
 * Shore shell surfaces for the prop shader (after the tree, conifer and palm shading: needs
 * getBarkFamily, perturbBarkNormal, barkScale and valueNoise). Procedural, no textures; every fine
 * term fades to its mean before it would alias (the analytic equivalent of a mip chain).
 * - bivalve: concentric growth lines, fine radial striae, tinted colour bands; scallop chevrons,
 *   cockle blotches, smooth clams with concentric bands;
 * - nacre: off-white porcelain inside with faint radial ridges and growth lines; pearls;
 * - sea star: fine granules and cartoon white dots on top;
 * - spiral: whorl growth lines with brown or orange spiral bands, mottled flames, cords, zigzag
 *   flames or cowrie spots.
 * uv: (around, along + pattern * stride) inside the bark family of the surface.
 */
export const SHELL_SHADING_GLSL = `
const float SHELL_BIVALVE = ${glslFloat(BARK_FAMILY.shellBivalve)};
const float SHELL_NACRE = ${glslFloat(BARK_FAMILY.shellNacre)};
const float SHELL_STAR = ${glslFloat(BARK_FAMILY.seaStar)};
const float SHELL_SPIRAL = ${glslFloat(BARK_FAMILY.spiralShell)};
const float SHELL_PATTERN_STRIDE = ${glslFloat(SHELL_PATTERN_STRIDE)};
const vec3 SHELL_BROWN = vec3(0.34, 0.18, 0.09);
const vec3 SHELL_CREAM = vec3(1.0, 0.95, 0.84);
/** Band colour as a tint of the base: white shells get orange bands, orange ones red. */
const vec3 SHELL_BAND_TINT = vec3(1.0, 0.5, 0.3);

/**
 * Seen from behind (the inside of a spiral shell through its aperture, the underside of a valve):
 * the normal turns to the viewer and the inside reads as a shaded pinkish recess, not a flat face.
 */
const vec3 SHELL_INSIDE = vec3(0.85, 0.62, 0.58);
/** Deep inside a shell (the recess behind an aperture). */
const vec3 SHELL_RECESS = vec3(0.24, 0.13, 0.11);
/** Albedo ceiling and peak radiance: shells are lit surfaces and must never reach bloom. */
const float SHELL_MAX_ALBEDO = 0.82;
const float SHELL_MAX_RADIANCE = 0.64;
const float SHELL_KNEE_START = 0.45;
/** Pearl: pure white albedo and a slightly higher radiance ceiling, still under the bloom knee. */
const vec3 SHELL_PEARL = vec3(0.96);
const float SHELL_PEARL_RADIANCE = 0.72;

/** Band window of half width around the centre, antialiased by the pixel footprint. */
float shellBand(float coordinate, float centre, float width) {
  float blur = max(fwidth(coordinate) * 1.5, width * 0.35);
  return 1.0 - smoothstep(width - blur, width + blur, abs(coordinate - centre));
}

bool isShellSurface(vec2 uv) {
  float family = getBarkFamily(uv);
  return uv.x < BARK_UV_LIMIT && family >= SHELL_BIVALVE && family <= SHELL_SPIRAL;
}

/** 1 while a pattern of coordinate x is resolved, 0 once its cells shrink below ~3 pixels. */
float shellDetail(float x) {
  return 1.0 - smoothstep(0.1, 0.3, fwidth(x));
}

/**
 * Growth lines: a soft continuous modulation (0..1) once per coordinate unit, faded out before the
 * line spacing drops under a few pixels (never dark dots or stitches).
 */
float shellLines(float coordinate) {
  return (0.5 - 0.5 * cos(coordinate * 6.2831853)) * shellDetail(coordinate);
}

float shellHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Distances to the nearest and second nearest jittered cell point (granules, plates). */
vec2 shellCells(vec2 p) {
  vec2 cell = floor(p);
  vec2 nearest = vec2(8.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 at = cell + vec2(float(x), float(y));
    vec2 point = at + 0.15 + 0.7 * vec2(shellHash(at), shellHash(at + 17.3));
    float d = length(point - p);
    if (d < nearest.x) nearest = vec2(d, nearest.x);
    else nearest.y = min(nearest.y, d);
  }
  return nearest;
}

/** Albedo multiplier (rgb) and relief height (a) of a bivalve outer face. */
vec4 shellBivalve(vec3 base, float around, float radial, float pattern) {
  float angle = (around - 0.5) * 6.2831853;
  float ribs = pattern == 1.0 ? 9.0 : 7.0;
  float growth = radial * 34.0 + valueNoise(vec2(around * 23.0, radial * 6.0)) * 0.9;
  float line = shellLines(growth);
  float striae = (0.5 + 0.5 * cos(angle * ribs * 5.0)) * shellDetail(angle * ribs * 5.0 / 6.2831853);
  float plain = pattern == 2.0 ? 1.0 : 0.0;
  float groove = mix(0.5 + 0.5 * cos(angle * ribs), 1.0, plain);
  striae *= 1.0 - plain;
  float band = smoothstep(0.35, 0.75, valueNoise(vec2(radial * 7.0, pattern * 3.1 + 1.0)));
  float bandStrength = pattern == 0.0 ? 0.45 : 0.8;
  vec3 color = mix(base, base * SHELL_BAND_TINT, band * bandStrength) * mix(0.6, 1.0, groove) * (1.0 - line * 0.08);
  if (pattern == 0.0) {
    float zig = fract(radial * 9.0 + abs(fract(angle * ribs / 12.566) - 0.5) * 1.4);
    float chevron = smoothstep(0.5, 0.62, zig) * smoothstep(0.92, 0.8, zig) * shellDetail(radial * 9.0);
    float spread = smoothstep(0.4, 0.6, valueNoise(vec2(angle * 3.0, radial * 4.0 + 7.0)));
    color = mix(color, base * vec3(0.7, 0.5, 0.44), chevron * spread * 0.35);
  } else if (pattern == 1.0) {
    float blotch = smoothstep(0.58, 0.68, valueNoise(vec2(angle * 5.0 + 3.0, radial * 6.0)));
    color = mix(color, SHELL_BROWN * 1.6, blotch * 0.65);
  } else {
    float ring = fract(radial * 5.5 + valueNoise(vec2(angle * 2.0, radial * 3.0)) * 0.5);
    float concentric = smoothstep(0.35, 0.45, ring) * smoothstep(0.8, 0.7, ring);
    color = mix(color, base * vec3(0.72, 0.68, 0.6), concentric * 0.7);
  }
  float height = 0.55 + groove * 0.25 - line * 0.12 + striae * 0.06;
  return vec4(color, height);
}

/**
 * Inside of a valve: off-white / light grey-beige porcelain (the instance tint mostly removed),
 * a little dirty, faint radial ridges echoing the outer ribs and faint growth lines. Pattern 3 is
 * a pearl: clean white with a soft pearly sheen.
 */
vec4 shellNacre(vec3 base, float around, float radial, vec3 normal, float pattern) {
  float luma = dot(base, vec3(0.3, 0.59, 0.11));
  if (pattern == 3.0) {
    // Snow white pearl (the instance tint ignored) with a very faint cool sheen.
    float cool = 0.5 + 0.5 * dot(normal, uViewDirection);
    return vec4(SHELL_PEARL * mix(vec3(1.0), vec3(0.97, 0.985, 1.0), cool), 0.6);
  }
  vec3 porcelain = mix(vec3(luma) * vec3(0.98, 0.95, 0.9), base, 0.18);
  float dirt = 0.9 + 0.1 * valueNoise(vec2(around * 30.0, radial * 12.0));
  float ribs = pattern == 1.0 ? 9.0 : 7.0;
  float ridge = pattern == 2.0 ? 0.0 : 0.5 + 0.5 * cos((around - 0.5) * 6.2831853 * ribs);
  float line = shellLines(radial * 26.0 + valueNoise(vec2(around * 12.0, radial * 5.0)) * 0.3);
  vec3 color = porcelain * dirt * (0.94 + ridge * 0.06) * (1.0 - line * 0.04);
  return vec4(color, 0.55 + ridge * 0.2 - line * 0.08);
}

/**
 * Sea star top in arm-local coordinates (x along the arm, y across): fine granules plus cartoon
 * white dots scattered over the arms.
 */
vec4 shellStar(vec3 base, float around, float reach) {
  float across = (around - 0.5) * 1.2566;
  vec2 arm = vec2(cos(across), sin(across)) * reach;
  vec2 granule = shellCells(arm * 34.0);
  float fine = shellDetail(arm.x * 34.0);
  float bump = mix(0.6, 1.0 - smoothstep(0.12, 0.48, granule.x), fine);
  vec2 spots = shellCells(arm * 11.0 + 4.0);
  float spot = (1.0 - smoothstep(0.16, 0.24, spots.x)) * shellDetail(arm.x * 11.0);
  vec3 color = mix(base * mix(0.82, 1.08, bump), SHELL_CREAM, spot * 0.9);
  return vec4(color, bump * 0.6 + spot * 0.5);
}

/** Spiral shell: around 0..1 around the tube (0 outer periphery), along in whorl turns. */
vec4 shellSpiral(vec3 base, float around, float turns, float pattern) {
  float growth = turns * 44.0 + valueNoise(vec2(turns * 3.0, around * 4.0)) * 0.3;
  float line = shellLines(growth);
  vec3 color = base * (1.0 - line * 0.06);
  float height = 0.6 - line * 0.12;
  float wrapped = abs(fract(around + 0.5) - 0.5);
  if (pattern == 0.0) {
    float band = 0.0;
    for (int index = 0; index < 4; index++) {
      float centre = 0.04 + float(index) * 0.065;
      band = max(band, shellBand(wrapped, centre, 0.02));
    }
    color = mix(color, SHELL_BROWN, band * 0.85);
  } else if (pattern == 1.0) {
    float flame = smoothstep(0.45, 0.6, valueNoise(vec2(turns * 14.0 + sin(around * 25.0) * 0.4, around * 7.0)));
    float band = 1.0 - smoothstep(0.03, 0.08, abs(wrapped - 0.1));
    color = mix(color, SHELL_BROWN * 1.2, max(flame * 0.75, band * 0.8 * (1.0 - flame * 0.5)));
  } else if (pattern == 2.0) {
    float cord = 0.5 + 0.5 * cos(around * 6.2831853 * 14.0);
    float stripe = 1.0 - smoothstep(0.0, 0.25, abs(fract(around * 14.0 / 3.0) - 0.5));
    color = mix(color * mix(0.85, 1.0, cord), SHELL_BROWN * 1.5, stripe * 0.35);
    height += cord * 0.3;
  } else if (pattern == 3.0) {
    float zig = fract(turns * 9.0 + abs(fract(around * 6.0) - 0.5) * 0.5 +
      valueNoise(vec2(turns * 5.0, around * 3.0)) * 0.25);
    float flame = smoothstep(0.3, 0.4, zig) * smoothstep(0.72, 0.6, zig) * shellDetail(turns * 9.0);
    float shoulder = 1.0 - smoothstep(0.03, 0.07, abs(wrapped - 0.15));
    color = mix(color, base * vec3(0.66, 0.36, 0.2), flame * 0.8);
    color = mix(color, SHELL_CREAM, shoulder * 0.6);
  } else if (pattern == 4.0) {
    float band = 0.0;
    for (int index = 0; index < 3; index++) {
      band = max(band, shellBand(wrapped, 0.05 + float(index) * 0.13, 0.04));
    }
    color = mix(color, base * SHELL_BAND_TINT, band * 0.9);
  } else {
    vec2 spots = shellCells(vec2(turns * 9.0, around * 7.0));
    float spot = (1.0 - smoothstep(0.22, 0.32, spots.x)) * shellDetail(turns * 9.0);
    color = mix(color, SHELL_BROWN * 1.3, spot * 0.85);
  }
  return vec4(color, height);
}

vec3 lightShell(vec3 base, vec3 normal, vec2 uv, vec3 world, float sunVisibility) {
  float family = getBarkFamily(uv);
  if (family == SHELL_SPIRAL && dot(normal, uViewDirection) < 0.0) {
    normal = -normal;
    base = mix(SHELL_RECESS, SHELL_INSIDE, 0.35);
  }
  vec2 shell = vec2(-uv.x - BARK_UV_OFFSET - family * BARK_STRIDE, uv.y);
  float pattern = floor(shell.y / SHELL_PATTERN_STRIDE);
  float along = shell.y - pattern * SHELL_PATTERN_STRIDE;
  vec4 surface;
  if (family == SHELL_BIVALVE) surface = shellBivalve(base, shell.x, along, pattern);
  else if (family == SHELL_NACRE) surface = shellNacre(base, shell.x, along, normal, pattern);
  else if (family == SHELL_STAR) surface = shellStar(base, shell.x, along);
  else surface = shellSpiral(base, shell.x, along, pattern);
  float depth = family == SHELL_STAR ? 0.012 : 0.006;
  vec3 bumped = perturbBarkNormal(normal, world, surface.a * depth * barkScale(vec2(shell.x, along), world));
  bool pearl = family == SHELL_NACRE && pattern == 3.0;
  float gloss = family == SHELL_NACRE ? (pearl ? 0.9 : 0.12) : 0.1;
  surface.rgb = min(surface.rgb, vec3(pearl ? 0.96 : SHELL_MAX_ALBEDO));
  // Pearl: a smooth reflective sphere (roughness about 0.1): a crisp sun highlight, the sky probe
  // mirrored with a Fresnel weight and a soft bright rim.
  float sharpness = pearl ? 420.0 : 48.0;
  float highlight = pow(max(dot(bumped, normalize(uSunDirection + uViewDirection)), 0.0), sharpness);
  float occlusion = mix(0.85, 1.0, surface.a);
  vec3 lit = lightSurface(surface.rgb, bumped, sunVisibility, occlusion, world.xz);
  // Peak radiance rolls off softly towards SHELL_MAX_RADIANCE, under the bloom prefilter
  // (threshold 0.8 minus its 0.15 knee in daylight); hue and shading gradients hold.
  vec3 shaded = lit + uSunColor * highlight * gloss * sunVisibility;
  if (pearl) {
    float facing = max(dot(bumped, uViewDirection), 0.0);
    float fresnel = 0.08 + 0.92 * pow(1.0 - facing, 5.0);
    vec3 mirrored = skyReflection(reflect(-uViewDirection, bumped));
    shaded = mix(shaded, mirrored, fresnel * 0.7) + uAmbientSky * 0.06 * pow(1.0 - facing, 2.0);
  }
  float peak = max(shaded.r, max(shaded.g, shaded.b));
  float excess = max(peak - SHELL_KNEE_START, 0.0);
  float ceiling = pearl ? SHELL_PEARL_RADIANCE : SHELL_MAX_RADIANCE;
  float rolled = SHELL_KNEE_START + excess / (1.0 + excess / (ceiling - SHELL_KNEE_START));
  return shaded * (rolled / max(peak, 1e-4));
}
`;
