import { expect, it } from "vitest";

import { isWindowGlowMesh } from "../src/renderers/three/buildings/window-glow";

it("glows real windows but never decorative roof-vent, well or doorway shadow panes", () => {
  expect(isWindowGlowMesh({ userData: { windowShadow: true } })).toBe(true);
  expect(isWindowGlowMesh({ userData: { openingShadow: true } })).toBe(true);
  expect(isWindowGlowMesh({ userData: { windowShadow: true, windowShadowDecorative: true } })).toBe(false);
  expect(isWindowGlowMesh({ userData: { openingShadow: true, windowShadowDecorative: true } })).toBe(false);
  expect(isWindowGlowMesh({ userData: {} })).toBe(false);
});
