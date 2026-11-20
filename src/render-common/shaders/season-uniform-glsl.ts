/**
 * The shared season weights (x autumn, y dormant, z spring, w monsoon; season-weights.ts). Guarded, so the
 * foliage tones, the water and the spring flowers may all include it in one stage.
 */
export const SEASON_UNIFORM_GLSL = `
#ifndef SEASON_UNIFORM
#define SEASON_UNIFORM
uniform vec4 uSeason;
#endif
`;
