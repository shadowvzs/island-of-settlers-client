/** Root attributes of the non-destructive HUD scope, one per reason (scoped CSS reads them). */
export const HUD_SCOPE_ATTRIBUTES = Object.freeze({
  /** Campaign cinematic: everything but the scene and the cinematic overlay is hidden. */
  cinematic: Object.freeze({ attribute: "data-cinematic", value: "on" }),
  /** Possessed/FPS view: the HUD is hidden except the identity portrait and the exploration minimap. */
  exploration: Object.freeze({ attribute: "data-exploration-hud", value: "hidden" })
});
