/** Preserve the existing human doorway and shoulder-cargo clearance in the smaller mill. */
const originalVisibleTop = 3.15 + 2.01 - .18;
const reducedVisibleTop = originalVisibleTop * .8;
const minimumSailBottom = 1.70 / (1.12 / .63);
export const ROMAN_MILL_ROTOR_RADIUS = (reducedVisibleTop - minimumSailBottom) / 2;
export const ROMAN_MILL_ROTOR_SCALE = ROMAN_MILL_ROTOR_RADIUS / 2.01;
export const ROMAN_MILL_ROTOR_HALF_DEPTH = .11 * ROMAN_MILL_ROTOR_SCALE;
export const ROMAN_MILL_HUB_HEIGHT = .18 + (reducedVisibleTop + minimumSailBottom) / 2;
