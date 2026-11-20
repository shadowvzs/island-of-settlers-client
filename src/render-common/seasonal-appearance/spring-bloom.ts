type Rgb = readonly [number, number, number];

/**
 * Spring meadow flower opening (spring-flowers.ts; prop shader SPRING_BLOOM and its TSL twin). The bloom ramp
 * follows the spring weight from its second half on: in winter -> spring the snow (global winter) gives way at
 * mid-transition first, then the flowers open; in spring -> summer they close again before mid-transition.
 */
export const SPRING_BLOOM = Object.freeze({
  /** The spring weight where the first flowers open and where every flower is open. */
  fullAt: 0.95,
  startAt: 0.52,
  /** Ramp span over which one flower grows from bud to full size. */
  openSpan: 0.1,
  /** Closed-bud colour: a flower starts as a small green bud and takes its petal colour as it opens. */
  budTone: [0.36, 0.5, 0.2] as Rgb
});

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 0..1 of the flower bloom ramp for a spring weight (0: no flower is drawn). */
export const getSpringBloomRamp = (spring: number) => smoothstep(SPRING_BLOOM.startAt, SPRING_BLOOM.fullAt, spring);

/** Spring flower samples per cell for a preset's field-cover density (Minimal, without field cover: 3). */
export const getSpringFlowerSamples = (grassSamples: number) => Math.max(3, Math.round(grassSamples * 0.7));

const glslFloat = (value: number) => value.toFixed(4);

/**
 * Vertex stage (needs SEASON_UNIFORM_GLSL): `getSpringBloom(phase)` is the open state of one flower whose bloom
 * point (0..1 of the ramp) rides in its phase. The ramp is stretched a little so the latest flowers open fully.
 */
export const SPRING_BLOOM_GLSL = `
const vec3 SPRING_BUD = vec3(${SPRING_BLOOM.budTone.map(glslFloat).join(", ")});
float getSpringBloom(float phase) {
  float ramp = smoothstep(${glslFloat(SPRING_BLOOM.startAt)}, ${glslFloat(SPRING_BLOOM.fullAt)}, uSeason.z);
  float point = fract(phase * 0.15915494);
  return smoothstep(point, point + ${glslFloat(SPRING_BLOOM.openSpan)},
    ramp * ${glslFloat(1 + SPRING_BLOOM.openSpan)});
}
`;
