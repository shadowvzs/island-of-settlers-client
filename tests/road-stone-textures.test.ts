import type { DataTexture, Texture } from "three";
import { describe, expect, it } from "vitest";

import { createRoadMaterial } from "../src/renderers/three/settlement/road-materials";

const PAVED_TIERS = ["stone", "marble", "limestone", "basalt", "granite"] as const;

const hashBytes = (bytes: Uint8Array) => {
  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const readBytes = (texture: Texture | null) =>
  ((texture as DataTexture).image.data as Uint8Array);

describe("paved road textures", () => {
  it.each(PAVED_TIERS)("bakes a complete unique %s map and relief", tier => {
    const material = createRoadMaterial(tier, true);
    try {
      const pixels = readBytes(material.map);
      const relief = readBytes(material.bumpMap);
      expect(pixels).toHaveLength(256 * 256 * 4);
      expect(relief).toHaveLength(256 * 256 * 4);
      expect(pixels.every((_, index) => index % 4 !== 3 || pixels[index] === 255)).toBe(true);
      expect(new Set(pixels.filter((_, index) => index % 4 !== 3)).size).toBeGreaterThan(48);
      expect(new Set(relief.filter((_, index) => index % 4 !== 3)).size).toBeGreaterThan(48);
    } finally {
      material.map?.dispose();
      material.bumpMap?.dispose();
      material.dispose();
    }
  });

  it("gives every paved tier a distinct colour and relief fingerprint", () => {
    const fingerprints = PAVED_TIERS.map(tier => {
      const material = createRoadMaterial(tier, true);
      try {
        return `${hashBytes(readBytes(material.map))}:${hashBytes(readBytes(material.bumpMap))}`;
      } finally {
        material.map?.dispose();
        material.bumpMap?.dispose();
        material.dispose();
      }
    });
    expect(new Set(fingerprints).size).toBe(PAVED_TIERS.length);
  });
});
