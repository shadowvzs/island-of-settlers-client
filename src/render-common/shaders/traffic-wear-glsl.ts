import { TRAFFIC_WEAR_TUNING } from "../traffic-wear-tuning";

const glslFloat = (value: number) => value.toFixed(4);
const WEAR = TRAFFIC_WEAR_TUNING;
/** Phase and sideways shift of each extra line of prints: other walkers beside the first one. */
const PRINT_LINE_SHIFTS = [[0, 0], [0.37, 0.085], [0.71, -0.07]] as const;

/**
 * Traffic wear field access (WEAR-3). RGBA8, one texel per cell: R = off-road walker wear,
 * G = handcart wheel wear on dirt roads, B/A = the trail line through the texel (direction folded
 * to 0..π, signed offset from the texel centre; A = 0 means no line, traffic-wear-lines.ts).
 * The covered world size comes from the texture itself, so no other uniform is needed (an unbound
 * field is a 1 x 1 zero texel).
 */
export const TRAFFIC_WEAR_FIELD_GLSL = `
uniform sampler2D uTrafficWear;

vec4 sampleTrafficWearField(vec2 xz) {
  return texture(uTrafficWear, xz * ${glslFloat(WEAR.texelsPerCell)} / vec2(textureSize(uTrafficWear, 0)));
}
`;

const TEXELS = glslFloat(WEAR.texelsPerCell);
const CYCLE = glslFloat(WEAR.footCycle);

/** Line reconstruction for footprints and ruts only (the lite ground never needs it). */
const TRAFFIC_WEAR_LINE_GLSL = `
ivec2 trafficWearCell(vec2 xz) {
  return clamp(ivec2(floor(xz * ${TEXELS})), ivec2(0), textureSize(uTrafficWear, 0) - 1);
}

/** The trail line stored in \`cell\`: x/y its direction, z the signed distance of \`xz\`; w 0 = none. */
vec4 trafficWearLineAt(ivec2 cell, vec2 xz) {
  cell = clamp(cell, ivec2(0), textureSize(uTrafficWear, 0) - 1);
  vec4 line = texelFetch(uTrafficWear, cell, 0);
  if (line.a < 0.5 / 255.0) return vec4(0.0);
  float angle = (line.b * 255.0 + 0.5) * 3.14159265 / 256.0;
  vec2 direction = vec2(cos(angle), sin(angle));
  float offset = ((line.a * 255.0 - 1.0) / 127.0 - 1.0) * ${glslFloat(WEAR.lineOffsetRange)};
  vec2 local = xz - (vec2(cell) + 0.5) / ${TEXELS};
  return vec4(direction, dot(local, vec2(-direction.y, direction.x)) - offset, 1.0);
}

vec4 trafficWearLine(vec2 xz) {
  return trafficWearLineAt(trafficWearCell(xz), xz);
}
`;

/** Ground tint shared by the full and the lite ground (needs TRAFFIC_WEAR_FIELD_GLSL). */
export const TRAFFIC_WEAR_GLSL = `${TRAFFIC_WEAR_FIELD_GLSL}
const vec3 TRAFFIC_WEAR_EARTH = vec3(${WEAR.earth.map(glslFloat).join(", ")});
const vec3 TRAFFIC_PACKED_EARTH = vec3(${WEAR.packedEarth.map(glslFloat).join(", ")});
const vec3 TRAFFIC_WEAR_SNOW_PRINT = vec3(${WEAR.snowPrint.map(glslFloat).join(", ")});
const vec3 TRAFFIC_WEAR_SNOW_PACKED = vec3(${WEAR.snowPacked.map(glslFloat).join(", ")});
const vec3 TRAFFIC_WEAR_SNOW_RIM = vec3(${WEAR.snowRim.map(glslFloat).join(", ")});

/**
 * Trampled ground tint: earth on dry ground, packed grey-white snow where the ground is snowy.
 * \`snowCover\` is 0 on summer ground, so that path keeps the old earth look byte for byte.
 */
vec3 trafficWearTint(vec3 albedo, float snowCover, float packed) {
  float brightness = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) / 0.16, 0.7, 1.35);
  float snowBrightness = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) * 1.15, 0.78, 1.06);
  vec3 earth = mix(TRAFFIC_WEAR_EARTH * brightness, TRAFFIC_PACKED_EARTH, packed);
  return mix(earth, TRAFFIC_WEAR_SNOW_PACKED * snowBrightness, snowCover);
}

/** Trampled ground by its wear share; the heaviest (village yards) is packed, dusty earth. */
vec3 applyTrafficWear(vec3 albedo, float wear, float snowCover) {
  if (wear <= 0.0) return albedo;
  float packed = smoothstep(${glslFloat(WEAR.packedRange[0])}, ${glslFloat(WEAR.packedRange[1])}, wear);
  return mix(albedo, trafficWearTint(albedo, snowCover, packed), wear);
}

/** Minimal: no footprints, only a patchy tint where paths are heavily used (\`breakup\` 0..1). */
float sampleLiteTrafficWear(vec2 xz, float breakup, float snowCover) {
  float start = mix(${glslFloat(WEAR.liteStart)}, ${glslFloat(WEAR.snowLiteStart)}, snowCover);
  float full = mix(${glslFloat(WEAR.liteFull)}, ${glslFloat(WEAR.snowLiteFull)}, snowCover);
  float wear = smoothstep(start, full, sampleTrafficWearField(xz).r);
  return wear * mix(0.55, 1.0, breakup) * ${glslFloat(WEAR.groundStrength)};
}
`;

const printLineCall = ([start, full]: readonly [number, number], index: number) => {
  const [phase, shift] = PRINT_LINE_SHIFTS[index]!, spacing = WEAR.footHalfSpacing;
  return `  weight = smoothstep(${glslFloat(start)}, ${glslFloat(full)}, density);
  if (weight > 0.0) prints = max(prints, weight * max(
    trafficFootLane(xz, line, cell, ${glslFloat(phase + 0.5)}, ${glslFloat(shift + spacing)}, 1.0, ${index}.0, soft),
    trafficFootLane(xz, line, cell, ${glslFloat(phase)}, ${glslFloat(shift - spacing)}, -1.0, ${index}.5, soft)));`;
};

/**
 * Full ground: footprints along the real trail line. Each line of prints is a walker's left and
 * right sole, one each per walk cycle, `footHalfSpacing` beside the line; more lines (other
 * walkers) appear only with more wear, and patchy trampled earth fills in only where steps merged
 * (needs NOISE_GLSL). Returns x = trampled share of the albedo, y = print depth (darker, occluded imprint).
 */
export const TRAFFIC_TREAD_GLSL = `${TRAFFIC_WEAR_LINE_GLSL}
const float TRAFFIC_PRINT_OCCLUSION = ${glslFloat(WEAR.printOcclusion)};

/**
 * World-space slope of a screen-space value (the print coverage): the lighting side of a print
 * needs to know where its sun-facing and shaded edges lie. \`worldDx\`/\`worldDy\` are the world
 * derivatives of the pixel; the determinant is zero only for degenerate pixels.
 */
vec2 trafficPrintSlope(float screenDx, float screenDy, vec2 worldDx, vec2 worldDy) {
  float determinant = worldDx.x * worldDy.y - worldDx.y * worldDy.x;
  if (abs(determinant) < 1e-8) return vec2(0.0);
  return vec2(screenDx * worldDy.y - screenDy * worldDx.y,
    worldDx.x * screenDy - worldDy.x * screenDx) / determinant;
}

/**
 * A print is pressed, bare earth on dry ground; in sand (\`sand\` share) a shaded hollow of the same sand,
 * not dark earth (dark earth prints read as a hatched grid on the beach, review 2026-11-17). In snow it is
 * a compressed cool hollow: a packed grey-blue sole with a faint lit rim, shaded on the side away from the sun; the white snow around
 * it supplies the bright rim. No earth colour enters the snow path.
 */
vec3 applyTrafficPrints(vec3 albedo, float prints, float snowCover, vec2 worldDx, vec2 worldDy, float sand) {
  if (prints <= 0.0) return albedo;
  vec3 earth = mix(TRAFFIC_WEAR_EARTH * (1.0 - ${glslFloat(WEAR.printDarken)}),
    albedo * ${glslFloat(WEAR.sandPrintShade)}, sand);
  if (snowCover <= 0.001) return mix(albedo, earth, prints * 0.85);
  float snowBrightness = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) * 1.15, 0.78, 1.06);
  vec3 snow = TRAFFIC_WEAR_SNOW_PRINT * snowBrightness;
  float rim = smoothstep(0.08, 0.35, prints) * (1.0 - smoothstep(0.55, 0.92, prints));
  snow = mix(snow, TRAFFIC_WEAR_SNOW_RIM * snowBrightness, rim * ${glslFloat(WEAR.snowRimStrength)});
  vec2 slope = trafficPrintSlope(dFdx(prints), dFdy(prints), worldDx, worldDy);
  float slopeLength = length(slope);
  vec2 sunXz = uSunDirection.xz;
  float sunLength = length(sunXz);
  float sunSide = slopeLength > 1e-5 && sunLength > 1e-4
    ? -dot(slope / slopeLength, sunXz / sunLength) : 0.0;
  snow *= 1.0 + sunSide * ${glslFloat(WEAR.snowSunShade)} * smoothstep(0.0, 0.18, slopeLength);
  return mix(albedo, mix(earth, snow, snowCover), prints * 0.85);
}

float trafficPrintHash(float index, float salt) {
  return fract(sin(index * 12.9898 + salt * 78.233) * 43758.5453);
}

/**
 * One sole: \`along\`/\`across\` from its centre (cells); the ball is wider than the heel. A superellipse
 * keeps the toe end blunt and rounded like a real foot/shoe front (owner 2026-11-08: no pointed toe);
 * the heel stays a softer round.
 */
float trafficSole(float along, float across, float side, float soft) {
  float turn = side * ${glslFloat(WEAR.footToeOut)};
  float a = along * cos(turn) - across * sin(turn);
  float b = along * sin(turn) + across * cos(turn);
  float u = a / ${glslFloat(WEAR.footHalfLength)};
  float halfWidth = ${glslFloat(WEAR.footHalfWidth)} * mix(0.72, 1.0, smoothstep(-0.6, 0.3, u));
  float roundness = mix(${glslFloat(WEAR.footHeelRoundness)}, ${glslFloat(WEAR.footToeRoundness)},
    smoothstep(-0.2, 0.2, u));
  float radius = pow(pow(abs(u), roundness) + pow(abs(b / halfWidth), roundness), 1.0 / roundness);
  float distanceOut = (radius - 1.0) * halfWidth;
  return 1.0 - smoothstep(-soft, soft, distanceOut);
}

/**
 * The print of one foot lane nearest \`xz\`, \`lane\` cells beside the line, drawn only by the texel
 * that holds its centre: a print is never split at a texel border.
 */
float trafficFootLane(vec2 xz, vec4 line, ivec2 cell, float phase, float lane, float side, float salt,
  float soft) {
  float stride = dot(xz, line.xy) / ${CYCLE} + phase;
  float index = floor(stride);
  float along = (stride - index - 0.5) * ${CYCLE}, across = line.z - lane;
  vec2 centre = xz - line.xy * along - vec2(-line.y, line.x) * across;
  if (ivec2(floor(centre * ${TEXELS})) != cell) return 0.0;
  return trafficSole(along, across, side, soft) * mix(0.55, 1.0, trafficPrintHash(index, salt));
}

/** Every print line of the trail stored in \`cell\` (more lines with more wear). */
float trafficCellPrints(vec2 xz, ivec2 cell, float density, float soft) {
  vec4 line = trafficWearLineAt(cell, xz);
  if (line.w <= 0.0) return 0.0;
  float prints = 0.0, weight = 0.0;
${WEAR.printLines.map(printLineCall).join("\n")}
  return prints;
}

vec2 sampleTrafficTread(vec2 xz, float pixel, float snowCover) {
  float density = sampleTrafficWearField(xz).r;
  if (density <= ${glslFloat(WEAR.printLines[0][0])}) return vec2(0.0);
  float fillStart = mix(${glslFloat(WEAR.fillStart)}, ${glslFloat(WEAR.snowFillStart)}, snowCover);
  float fill = smoothstep(fillStart, ${glslFloat(WEAR.fillFull)}, density);
  ivec2 cell = trafficWearCell(xz);
  float soft = max(0.01, pixel * 0.75);
  float prints = trafficCellPrints(xz, cell, density, soft);
  // Prints owned by the neighbouring texels reach over the nearest borders.
  vec2 local = fract(xz * ${TEXELS}) - 0.5;
  float reach = 0.5 - (${glslFloat(WEAR.footHalfLength)} + soft) * ${TEXELS};
  if (abs(local.x) > reach) prints = max(prints,
    trafficCellPrints(xz, cell + ivec2(local.x > 0.0 ? 1 : -1, 0), density, soft));
  if (abs(local.y) > reach) prints = max(prints,
    trafficCellPrints(xz, cell + ivec2(0, local.y > 0.0 ? 1 : -1), density, soft));
  vec4 line = trafficWearLineAt(cell, xz);
  if (line.w <= 0.0) return vec2(max(prints, fill * ${glslFloat(WEAR.fillShare)}) * ${glslFloat(WEAR.groundStrength)},
    prints);
  // Trampled earth hugs the line, widens with use, and stays patchy so the prints still read.
  vec2 grain = vec2(valueNoise(xz * 4.7), valueNoise(xz * 1.3 + 7.1));
  float halfWidth = 0.1 + 0.2 * fill + (grain.y - 0.5) * 0.12;
  float band = fill * (1.0 - smoothstep(halfWidth, halfWidth + 0.14, abs(line.z)));
  band *= ${glslFloat(WEAR.fillShare)} * smoothstep(0.15, 0.65, grain.x + fill * 0.25);
  return vec2(max(prints, band) * ${glslFloat(WEAR.groundStrength)}, prints);
}
`;

/** The two real wheel contacts of the stored cart line, a shared helper of dirt and paved wear. */
const TRAFFIC_WHEEL_GLSL = `
/** 1 on one of the cart's wheel tracks, fading out across \`halfWidth\` cells. */
float trafficWheelTrack(vec4 line, float halfWidth, float soft) {
  float wheel = abs(abs(line.z) - ${glslFloat(WEAR.wheelHalfGauge)});
  return 1.0 - smoothstep(halfWidth - soft, halfWidth + soft, wheel);
}
`;

/** Dirt-road ruts (needs TRAFFIC_WEAR_FIELD_GLSL): two wheel tracks along the real cart line. */
export const TRAFFIC_RUT_GLSL = `${TRAFFIC_WEAR_LINE_GLSL}${TRAFFIC_WHEEL_GLSL}
float trafficRutShade(vec2 xz) {
  float wear = smoothstep(${glslFloat(WEAR.rutStart)}, ${glslFloat(WEAR.rutFull)}, sampleTrafficWearField(xz).g);
  if (wear <= 0.0) return 1.0;
  vec4 line = trafficWearLine(xz);
  if (line.w <= 0.0) return 1.0;
  float soft = max(0.012, length(fwidth(xz)) * 0.6);
  float track = trafficWheelTrack(line, ${glslFloat(WEAR.rutHalfWidth)}, soft);
  return 1.0 - wear * ${glslFloat(WEAR.rutStrength)} * track;
}
`;

/**
 * Paved-road grooves (needs TRAFFIC_WEAR_FIELD_GLSL): the same real wheel contacts, but only after
 * heavy use, narrower and much fainter than dirt ruts; the field's decay makes them temporary.
 */
export const TRAFFIC_PAVED_GROOVE_GLSL = `${TRAFFIC_WEAR_LINE_GLSL}${TRAFFIC_WHEEL_GLSL}
float trafficPavedGrooveShade(vec2 xz) {
  float wear = smoothstep(${glslFloat(WEAR.pavedGrooveStart)}, ${glslFloat(WEAR.pavedGrooveFull)},
    sampleTrafficWearField(xz).g);
  if (wear <= 0.0) return 1.0;
  vec4 line = trafficWearLine(xz);
  if (line.w <= 0.0) return 1.0;
  float soft = max(0.008, length(fwidth(xz)) * 0.6);
  float track = trafficWheelTrack(line, ${glslFloat(WEAR.pavedGrooveWidth)}, soft);
  return 1.0 - wear * ${glslFloat(WEAR.pavedGrooveStrength)} * track;
}
`;

/**
 * Grass tufts flatten on heavily trodden paths (vertex stage, needs TRAFFIC_WEAR_FIELD_GLSL), so
 * desire paths read through High's 3D grass; the packed-earth yards (the heaviest wear) lose the
 * last tufts too (ground-palette-4), over a soft band of the linearly filtered field.
 */
export const TRAFFIC_GRASS_GLSL = `
float trafficGrassKeep(vec2 root) {
  float wear = sampleTrafficWearField(root).r;
  float trodden = 1.0 - 0.85 * smoothstep(${glslFloat(WEAR.printLines[1][0])}, ${glslFloat(WEAR.fillFull)}, wear);
  return trodden * (1.0 - smoothstep(${glslFloat(WEAR.grassBare[0])}, ${glslFloat(WEAR.grassBare[1])}, wear));
}
`;
