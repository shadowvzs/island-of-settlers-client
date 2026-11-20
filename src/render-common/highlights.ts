/**
 * Graphics "Highlights / glare" setting (owner 2026-11-09): one live 0..1 strength, the shared
 * `uHighlight` uniform. It scales only glare: sun glints and specular highlights (water, rocks,
 * leaves, animals, paddies, built-in materials), the surf / wake foam's extra brightness and the
 * bloom share. Diffuse light stays as it is, so at 0 every material still looks lit.
 * 1 (100 %) is the earlier (master) look: every use multiplies by exactly 1.0 there.
 */
export const NEUTRAL_HIGHLIGHTS = 1;

/**
 * The player's setting until they move the slider (owner 2026-11-09: 75 %, a little less glare
 * than the earlier look). An explicitly stored value always wins.
 */
export const DEFAULT_HIGHLIGHTS = 0.75;

/**
 * Foam brightness at 0 % glare: the surf and wake foam keep this share of their colour, so they
 * still read as white water but no longer glare against the beach (water-glsl.ts foamGlare).
 */
export const FOAM_GLARE_FLOOR = 0.72;

/**
 * Screen-space water reflection share kept at Highlights 0 (R18b): a mirror image is not glare, so it
 * only softens with the setting and never disappears.
 */
export const REFLECTION_GLARE_FLOOR = 0.5;

/** Any number to a valid strength: 0..1, non-finite values fall back to the default. */
export const clampHighlights = (value: number) => {
  if (!Number.isFinite(value)) return DEFAULT_HIGHLIGHTS;
  return Math.min(1, Math.max(0, value));
};

/** Stored percent (0..100) to a strength; missing or invalid keeps the default (100 %). */
export const parseHighlights = (stored: string | null) => {
  if (stored === null || stored.trim() === "") return DEFAULT_HIGHLIGHTS;
  const percent = Number(stored);
  if (!Number.isFinite(percent)) return DEFAULT_HIGHLIGHTS;
  return clampHighlights(percent / 100);
};

/** A strength as the stored whole percent. */
export const formatHighlights = (value: number) => String(Math.round(clampHighlights(value) * 100));

/**
 * A bloom value at this strength: the share the frame output adds and the clipped-texel boost
 * (frame-bloom-glsl.ts) both scale linearly, so clipped surfaces (sunlit grass tips, petals, surf
 * foam) lose their halo faster than the rest; 1 leaves the value exactly as it is.
 */
export const scaleBloomByHighlights = (value: number, highlights: number) =>
  value * clampHighlights(highlights);
