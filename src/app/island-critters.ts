import type { CritterManager } from "../render-common/critters/critter-manager";
import { CRITTER_SPECIES } from "../render-common/critters/critter-species";
import type { TerrainRenderer } from "../render-common/renderer-contract";
import { settingsStorage } from "./settings/graphics-settings";

interface CritterListing {
  index: number;
  name: string;
  screenX: number;
  screenY: number;
  x: number;
  /** Height (flying birds well above the ground). */
  y: number;
  z: number;
}

declare global {
  interface Window {
    /** Live decorative critters and where they are on screen (Playwright screenshots). */
    __listCritters?: () => CritterListing[];
    /** Kills a listed food critter (Playwright, death checks); false when it cannot die. */
    __killCritter?: (index: number) => boolean;
    /** Homes of the colonies whose members include a species name (captures find them). */
    __listCritterSites?: (name: string) => { x: number; z: number }[];
  }
}

interface DecorativeLayers {
  birds: { setEnabled: (enabled: boolean) => void };
  butterflies: { setEnabled: (enabled: boolean) => void };
  critters: { setDecorativeEnabled: (enabled: boolean) => void };
  /** The renderer's decorative fish schools (absent on presets without them). */
  fish?: { setEnabled: (enabled: boolean) => void };
  /** The renderer's rare whales (absent in renderers without them). */
  whales?: { setEnabled: (enabled: boolean) => void };
}

/**
 * The "Critters" setting (stored, on by default): every purely decorative life at once, the
 * ambient birds, the butterflies, the critters, the fish schools and the whales. Food animals (deer,
 * elk, rabbits, fish) are not affected: they always show. The budget controller (C13) may suppress the
 * shown layers for a while on a CPU-bound device; it never stores anything or overrides the player's choice.
 */
export const connectCritterSetting = (layers: DecorativeLayers) => {
  let enabled = settingsStorage.readCritters();
  let suppressed = false;
  const apply = () => {
    const shown = enabled && !suppressed;
    layers.birds.setEnabled(shown);
    layers.butterflies.setEnabled(shown);
    layers.critters.setDecorativeEnabled(shown);
    layers.fish?.setEnabled(shown);
    layers.whales?.setEnabled(shown);
  };
  apply();
  return {
    enabled,
    /** The player's choice (the budget controller only has a lever while it is on). */
    isEnabled: () => enabled,
    set: (value: boolean) => {
      enabled = value;
      apply();
      settingsStorage.writeCritters(value);
    },
    setSuppressed: (value: boolean) => {
      if (suppressed === value) return;
      suppressed = value;
      apply();
    }
  };
};

/**
 * `window.__listCritters`: every live critter with its species name and screen point;
 * `window.__killCritter`: kills a food critter (the hunters' API);
 * `window.__listCritterSites`: the homes of a species' colonies.
 */
export const connectCritterDebugHook = (critters: CritterManager, renderer: TerrainRenderer) => {
  if (!import.meta.env.DEV) return () => {};
  const { pool, sites } = critters.debug;
  window.__listCritters = () =>
    Array.from(pool.active.keys())
      .filter((index) => pool.active[index] === 1 && pool.hidden[index] === 0)
      .map((index) => {
        const [x, y, z] = [pool.x[index]!, pool.y[index]!, pool.z[index]!];
        const screen = renderer.projectToViewport(x, y, z);
        const name = CRITTER_SPECIES[pool.species[index]!]!.name;
        return { index, name, screenX: screen.x, screenY: screen.y, x, y, z };
      });
  window.__killCritter = critters.killCritter;
  window.__listCritterSites = (name) =>
    sites
      .filter((site) => site.members.some((member) => CRITTER_SPECIES[member]!.name === name))
      .map(({ x, z }) => ({ x, z }));
  return () => {
    delete window.__listCritters;
    delete window.__killCritter;
    delete window.__listCritterSites;
  };
};
