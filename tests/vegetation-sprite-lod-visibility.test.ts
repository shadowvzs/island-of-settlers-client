import { describe, expect, it } from "vitest";

import { showsSpriteLodMeshes } from "../src/renderers/three/three-vegetation-visibility";

describe("sprite LOD mesh visibility", () => {
  it("shows the 3D trees and plants in the possessed chunk split even after iso used the sprites", () => {
    expect(showsSpriteLodMeshes(true, true)).toBe(true);
  });

  it("hides them while the iso view draws the sprites and shows them otherwise", () => {
    expect(showsSpriteLodMeshes(false, true)).toBe(false);
    expect(showsSpriteLodMeshes(false, false)).toBe(true);
  });
});
