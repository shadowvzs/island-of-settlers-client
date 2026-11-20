import { smoothstep } from "../../shared/world/noise";

/**
 * Display-fog visibility (0 hidden .. 1 visible) where the cloud cover reveals the ground.
 * Ground shading, birds and other dissolving props share this band: below the start a point is
 * fully inside the cloud, above the end it is in clear air. A gradual band avoids the old binary
 * boundary where objects stayed opaque through the fog and then vanished in one frame.
 */
export const FOG_VISIBILITY_FADE_START = 0.1;
export const FOG_VISIBILITY_FADE_END = 0.45;
/** Above this visibility a surface is in clear air (the cloud cover is fully clear). */
export const FOG_CLEAR_VISIBILITY = 0.95;

/** 0 in the fog cloud .. 1 in clear visibility, smooth and monotonic between the band edges. */
export const getFogVisibilityFade = (visibility: number) =>
  smoothstep(FOG_VISIBILITY_FADE_START, FOG_VISIBILITY_FADE_END, visibility);

/**
 * GLSL twin of getFogVisibilityFade. Generated from the same constants so shader and unit
 * checks cannot drift apart; the screen-door dither turns it into transparent-looking coverage.
 */
export const FOG_VISIBILITY_FADE_GLSL = `
float fogVisibilityFade(float visibility) {
  return smoothstep(
    ${FOG_VISIBILITY_FADE_START.toFixed(2)},
    ${FOG_VISIBILITY_FADE_END.toFixed(2)},
    visibility
  );
}
`;
