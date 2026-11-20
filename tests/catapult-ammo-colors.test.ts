import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { catapultAmmoColor } from "../src/render-common/buildings/catapult-ammo-colors";
import { tintCatapultMaterial } from "../src/renderers/three/buildings/catapult-ammo-material";

describe("catapult ammunition colours (CAT-3)", () => {
  it("keeps plain stone unchanged and uses the existing material-family tints for variants", () => {
    expect(catapultAmmoColor("stone")).toBeUndefined();
    expect(catapultAmmoColor(undefined)).toBeUndefined();
    expect(catapultAmmoColor("basalt")).toEqual([.065, .085, .115]);
    expect(catapultAmmoColor("limestone")).toEqual([.88, .68, .40]);
    const marble = catapultAmmoColor("marble")!;
    expect(Math.min(...marble)).toBeGreaterThan(1);
  });

  it("reuses a cached material per base material and kind", () => {
    const base = new MeshStandardMaterial({ color: 0x808080 });
    const basalt = tintCatapultMaterial(base, "basalt");
    const again = tintCatapultMaterial(base, "basalt");
    const marble = tintCatapultMaterial(base, "marble");
    expect(basalt).toBe(again);
    expect(basalt).not.toBe(base);
    expect(marble).not.toBe(base);
    expect(tintCatapultMaterial(base, "stone")).toBe(base);
  });
});
