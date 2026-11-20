import { Texture } from "three";
import type { Material } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { needsStandInMapSync, textureOf } from "../src/renderers/three/webgpu/stand-in-map";

type MapMaterial = Material & { map: Texture | null };

const materialWithMap = (map: Texture | null) => ({
  map,
  userData: {} as Record<string, unknown>
} as unknown as MapMaterial);

describe("WebGPU stand-in late maps", () => {
  it("treats a null map slot as no map, not as a late map", () => {
    const source = materialWithMap(null);
    expect(textureOf(source, "map")).toBeNull();
    expect(needsStandInMapSync(materialWithMap(null), source)).toBe(false);
  });

  it("syncs a signpost/sail map that arrives after the stand-in was built", () => {
    const source = materialWithMap(null);
    const standIn = materialWithMap(null);
    const icon = new Texture();
    source.map = icon;
    expect(needsStandInMapSync(standIn, source)).toBe(true);
    standIn.userData.wg4MapSource = icon;
    expect(needsStandInMapSync(standIn, source)).toBe(false);
  });

  it("syncs again when the source replaces its map", () => {
    const first = new Texture();
    const second = new Texture();
    const source = materialWithMap(first);
    const standIn = materialWithMap(first);
    standIn.userData.wg4MapSource = first;
    expect(needsStandInMapSync(standIn, source)).toBe(false);
    source.map = second;
    expect(needsStandInMapSync(standIn, source)).toBe(true);
  });
});
