import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSystemCursorPreference } from "../src/app/cursors/cursor-preference";

const GAME_CSS = "src/app/cursors/game-cursors.css";
const ARMY_CSS = "src/app/settlement/army-order-cursor.css";
const TOKENS = ["default", "grab", "grabbing", "not-allowed", "pointer"];

describe("game cursor set", () => {
  it("points every cursor rule at existing 1x and 2x images", () => {
    for (const path of [GAME_CSS, ARMY_CSS]) {
      const urls = [...readFileSync(path, "utf8").matchAll(/url\("([^"]+)"\)/g)].map(([, url]) => url!);
      expect(urls.length, path).toBeGreaterThan(0);
      for (const url of urls) expect(existsSync(resolve(dirname(path), url)), url).toBe(true);
    }
  });

  it("gives each token its system keyword outside the game mode and as the image fallback", () => {
    const css = readFileSync(GAME_CSS, "utf8");
    const gameMode = css.slice(css.indexOf(":root:not([data-system-cursor])"));
    for (const token of TOKENS) {
      expect(css).toContain(`--cursor-${token}: ${token};`);
      expect(gameMode).toMatch(new RegExp(`--cursor-${token}: image-set\\([^;]+2x\\) \\d+ \\d+, ${token};`));
    }
  });

  it("uses the tokens with a system fallback in every feature stylesheet", () => {
    const css = readFileSync("src/app/styles.css", "utf8");
    expect(css).not.toMatch(/cursor:\s*pointer\b/);
    expect(css).toContain("cursor: var(--cursor-pointer, pointer)");
  });
});

describe("system cursor preference", () => {
  it("applies the stored choice at once and persists only real changes", () => {
    const persist = vi.fn(), apply = vi.fn();
    const preference = createSystemCursorPreference(false, persist, apply);
    expect(apply).toHaveBeenLastCalledWith(false);
    preference.setEnabled(false);
    expect(persist).not.toHaveBeenCalled();
    preference.setEnabled(true);
    expect(persist).toHaveBeenLastCalledWith(true);
    expect(apply).toHaveBeenLastCalledWith(true);
    expect(preference.getSnapshot()).toBe(true);
  });
});
