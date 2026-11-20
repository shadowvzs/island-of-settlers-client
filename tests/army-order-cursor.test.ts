import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { applyArmyCursor, type ArmyCursorMode, getArmyCursorMode } from "../src/app/settlement/army-order-cursor";

const CSS_PATH = "src/app/settlement/army-order-cursor.css";
const MODES: readonly ArmyCursorMode[] = ["move", "attack", "retreat", "enter", "rally", "add", "sail", "unload"];

describe("army order cursor", () => {
  it("maps each pending order to its own cursor", () => {
    for (const order of ["move", "attack", "retreat", "enter", "rally"] as const) {
      expect(getArmyCursorMode(order, false)).toBe(order);
      expect(getArmyCursorMode(order, true), "the order owns the cursor").toBe(order);
    }
  });

  it("shows the add cursor only in add-to-selection mode, and none without a mode", () => {
    expect(getArmyCursorMode(null, true)).toBe("add");
    expect(getArmyCursorMode(null, false)).toBeNull();
  });

  it("marks the surface while a mode is active and clears it when the mode ends", () => {
    const surface = { dataset: {} as DOMStringMap } as HTMLElement;
    applyArmyCursor(surface, "attack");
    expect(surface.dataset.armyCursor).toBe("attack");
    applyArmyCursor(surface, "move");
    expect(surface.dataset.armyCursor).toBe("move");
    applyArmyCursor(surface, null);
    expect("armyCursor" in surface.dataset).toBe(false);
  });

  it("styles every mode with an existing 1x and 2x cursor image and a hotspot", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    for (const mode of MODES) {
      const rule = css.match(new RegExp(`\\[data-army-cursor="${mode}"\\] \\{([^}]+)\\}`))?.[1];
      expect(rule, mode).toBeDefined();
      expect(rule).toMatch(new RegExp(`army-${mode}\\.png"\\) \\d+ \\d+,`));
      expect(rule).toMatch(new RegExp(`army-${mode}@2x\\.png"\\) 2x\\) \\d+ \\d+,`));
      for (const [, path] of rule!.matchAll(/url\("([^"]+)"\)/g))
        expect(existsSync(resolve(dirname(CSS_PATH), path!)), path).toBe(true);
    }
  });
});
