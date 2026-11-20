/**
 * Only real windows take the night window glow. Decorative shadow panes (roof vents, well shafts,
 * doorway backings) share the window-shadow mesh/material but must stay dark at night.
 */
export const isWindowGlowMesh = (object: { userData: Record<string, unknown> }) =>
  (object.userData.windowShadow === true || object.userData.openingShadow === true) &&
  object.userData.windowShadowDecorative !== true;
