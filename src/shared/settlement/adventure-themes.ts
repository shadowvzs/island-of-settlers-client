import { createRandom, deriveSeed } from "../world/rng";

/** Persisted on new offers; missing on legacy offers means their original meadow generation. */
export const ADVENTURE_THEMES = ["tropical", "forest", "winter", "desert", "swamp"] as const;
export type AdventureTheme = (typeof ADVENTURE_THEMES)[number];
export const isAdventureTheme = (value: unknown): value is AdventureTheme =>
  ADVENTURE_THEMES.some(theme => theme === value);
export const adventureThemeFor = (seed: number): AdventureTheme =>
  ADVENTURE_THEMES[Math.floor(createRandom(deriveSeed(seed, "adventure-theme"))() * ADVENTURE_THEMES.length)]!;
