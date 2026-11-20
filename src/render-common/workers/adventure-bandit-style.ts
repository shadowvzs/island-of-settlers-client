import type { AdventureTheme } from "../../shared/settlement/adventure-themes";

export interface AdventureBanditStyle {
  theme: AdventureTheme;
  headgear: "hood" | "headscarf" | "fur-hood" | "tricorn-wide" | "tricorn-tall" | "bandanna";
  masked: boolean;
  rangedWeapon: "bow" | "javelin";
  cloth: number;
  trim: number;
}

const PALETTES: Record<AdventureTheme, readonly [number, number]> = {
  desert: [0x386f93, 0xd9b874], forest: [0x526a3b, 0xb6985b],
  swamp: [0x596449, 0xafa16d], tropical: [0x317d83, 0xd8b367], winter: [0x465776, 0xd6c9aa]
};
const styles = new Map<AdventureTheme, readonly AdventureBanditStyle[]>();

const TROPICAL_HEADGEAR = ["tricorn-wide", "tricorn-tall", "bandanna", "headscarf"] as const;

const getBanditHeadgear = (theme: AdventureTheme, index: number): AdventureBanditStyle["headgear"] => {
  if (theme === "tropical") return TROPICAL_HEADGEAR[index]!;
  if (theme === "winter") return "fur-hood";
  return theme === "desert" ? "headscarf" : "hood";
};

/** Render-only identity: a saved island theme and stable actor ID determine appearance, never stats. */
export const adventureBanditStyle = (actorId: number, theme?: AdventureTheme): AdventureBanditStyle | undefined => {
  if (!theme) return undefined;
  let variants = styles.get(theme);
  if (!variants) {
    const [cloth, trim] = PALETTES[theme];
    variants = Array.from({ length: 4 }, (_, index) => ({ cloth, trim, theme,
      headgear: getBanditHeadgear(theme, index),
      masked: index !== 3, rangedWeapon: index % 2 === 0 ? "javelin" : "bow" }));
    styles.set(theme, variants);
  }
  // Keep the same identity after a renderer reload or after its shooter has died.
  let hash = Math.imul((actorId | 0) ^ (actorId >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return variants[(hash >>> 0) % variants.length];
};

export type MilitaryProjectileVisual = "arrow" | "javelin";
export const adventureProjectileVisual = (shooter: number, faction: number, theme?: AdventureTheme): MilitaryProjectileVisual =>
  faction > 0 && adventureBanditStyle(shooter, theme)?.rangedWeapon === "javelin" ? "javelin" : "arrow";
