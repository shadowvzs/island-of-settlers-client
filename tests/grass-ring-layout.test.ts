import { describe, expect, it } from "vitest";

import {
  createGrassRingGround,
  fillGrassRingGround,
  invalidateGrassRingGround,
  packGrassRingTint
} from "../src/render-common/grass/grass-ring-ground";
import {
  createGrassRingPatch,
  createGrassRingTiles,
  fillGrassRingTiles,
  getGrassRingBand,
  getGrassRingEdge,
  getGrassRingSettings,
  getGrassRingShare,
  getGrassRingTileReach,
  getGrassRingTuftKeep,
  getGrassRingWindowSamples,
  GRASS_RING_FALLOFF,
  GRASS_RING_PATCH_BLADES,
  GRASS_RING_TILE,
  GRASS_RING_TINT_RANGE
} from "../src/render-common/grass/grass-ring-layout";
import { QUALITY_PRESETS } from "../src/render-common/quality";

const dense = getGrassRingSettings("dense")!;
const compact = getGrassRingSettings("compact")!;

describe("grass ring presets (D7)", () => {
  it("is dense on High, compact on Medium and off on Low and Minimal", () => {
    expect(QUALITY_PRESETS.high.grassRing).toBe("dense");
    expect(QUALITY_PRESETS.medium.grassRing).toBe("compact");
    expect(QUALITY_PRESETS.low.grassRing).toBe("off");
    expect(QUALITY_PRESETS.minimal.grassRing).toBe("off");
    expect(getGrassRingSettings("off")).toBeNull();
  });
});

describe("grass ring patch", () => {
  it("keeps every root inside the tile and spreads each power-of-four prefix evenly", () => {
    const roots = createGrassRingPatch(GRASS_RING_PATCH_BLADES, 1);
    for (const value of roots) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(GRASS_RING_TILE);
    }
    for (const prefix of [4, 16, 64, 256]) {
      const side = Math.sqrt(prefix);
      const cells = new Set<number>();
      for (let blade = 0; blade < prefix; blade++) {
        const x = Math.floor((roots[blade * 2]! / GRASS_RING_TILE) * side);
        const z = Math.floor((roots[blade * 2 + 1]! / GRASS_RING_TILE) * side);
        cells.add(z * side + x);
      }
      expect(cells.size).toBe(prefix);
    }
  });

  it("is deterministic", () => {
    expect(createGrassRingPatch(64, 5)).toEqual(createGrassRingPatch(64, 5));
  });
});

describe("grass ring density (grass-lod)", () => {
  it("keeps full density near the eye and thins slower than 1 / d^2 so the ring edge meets the tufts", () => {
    expect(GRASS_RING_FALLOFF).toBeLessThan(2);
    for (const settings of [dense, compact]) {
      expect(getGrassRingShare(settings, 0.5)).toBe(settings.density);
      expect(getGrassRingShare(settings, settings.fullDensity)).toBe(settings.density);
      const edge = settings.radius * 0.7;
      // Grazing cover ~ distance x share: it may fall towards the edge, but by less than 1 / sqrt(d).
      const nearCover = settings.fullDensity * getGrassRingShare(settings, settings.fullDensity);
      const edgeCover = edge * getGrassRingShare(settings, edge);
      expect(edgeCover / nearCover).toBeGreaterThanOrEqual(Math.sqrt(settings.fullDensity / edge) - 1e-9);
    }
  });
});

describe("grass ring and tuft cross-fade (grass-band)", () => {
  it("keeps the meadow cover at the tufts' level across the band, whatever the noise", () => {
    for (const settings of [dense, compact]) {
      for (const noise of [0, 0.37, 1]) {
        for (let distance = 0; distance <= settings.radius + 2; distance += 0.25) {
          const ring = getGrassRingShare(settings, distance) * getGrassRingEdge(settings, distance, noise);
          const tufts = getGrassRingTuftKeep(settings, distance, noise) * settings.tuftCover;
          expect(ring + tufts).toBeGreaterThanOrEqual(settings.tuftCover - 1e-9);
          if (ring < settings.tuftCover) expect(ring + tufts).toBeCloseTo(settings.tuftCover, 9);
        }
      }
    }
  });

  it("starts the band well inside the ring, ends it at the radius and only pulls the fade inwards", () => {
    for (const settings of [dense, compact]) {
      expect(getGrassRingTuftKeep(settings, settings.fullDensity, 0)).toBe(0);
      expect(getGrassRingTuftKeep(settings, settings.radius * 0.5, 0)).toBeGreaterThan(0.15);
      expect(getGrassRingTuftKeep(settings, settings.radius, 0)).toBe(1);
      for (let distance = 0; distance < settings.radius; distance += 0.5)
        expect(getGrassRingEdge(settings, distance, 1)).toBeLessThanOrEqual(getGrassRingEdge(settings, distance, 0));
    }
  });
});

describe("grass ring bands", () => {
  it("never drops a blade the shader could still keep", () => {
    for (const settings of [dense, compact]) {
      for (let distance = 0; distance < settings.radius; distance += 0.25) {
        const band = settings.bands[getGrassRingBand(settings, distance)]!;
        const kept = getGrassRingShare(settings, distance) * GRASS_RING_PATCH_BLADES;
        expect(band.blades).toBeGreaterThanOrEqual(kept - 1e-6);
      }
    }
  });

  it("puts each tile of the ring in exactly one band and nothing beyond the radius", () => {
    const tiles = createGrassRingTiles(dense);
    fillGrassRingTiles(dense, 40, 50, tiles);
    const seen = new Set<string>();
    tiles.counts.forEach((count, band) => {
      for (let index = 0; index < count; index++) {
        const key = `${tiles.tiles[band]![index * 2]},${tiles.tiles[band]![index * 2 + 1]}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
    const reach = getGrassRingTileReach(dense);
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.size).toBeLessThanOrEqual((reach * 2 + 1) ** 2);
    expect(seen.has("40,50")).toBe(true);
    expect(tiles.counts[0]).toBeGreaterThan(0);
  });
});

describe("grass ring ground window", () => {
  it("fills only the samples that enter the window when the ring moves one tile", () => {
    const reach = getGrassRingTileReach(dense);
    const ground = createGrassRingGround(getGrassRingWindowSamples(dense));
    const calls: [number, number][] = [];
    const sample = (x: number, z: number, target: Float32Array, offset: number) => {
      calls.push([x, z]);
      target[offset] = x + z;
    };
    expect(fillGrassRingGround(ground, sample, 20, 20, reach)).toBe(ground.size * ground.size);
    calls.length = 0;
    const moved = fillGrassRingGround(ground, sample, 21, 20, reach);
    expect(moved).toBe(ground.size * (GRASS_RING_TILE / 0.5));
    expect(fillGrassRingGround(ground, sample, 21, 20, reach)).toBe(0);
    invalidateGrassRingGround(ground);
    expect(fillGrassRingGround(ground, sample, 21, 20, reach)).toBe(ground.size * ground.size);
  });
});

describe("grass ring tint packing", () => {
  it("keeps 8 bits per channel in one float and stays exact in float32", () => {
    const packed = packGrassRingTint(0.84, 1.3, 0.2);
    expect(Math.fround(packed)).toBe(packed);
    const steps = [Math.floor(packed / 65536), Math.floor(packed / 256) % 256, packed % 256];
    const decoded = steps.map(step => (step * GRASS_RING_TINT_RANGE) / 255);
    [0.84, 1.3, 0.2].forEach((value, index) => expect(decoded[index]).toBeCloseTo(value, 2));
    expect(packGrassRingTint(5, -1, 2)).toBe(255 * 65536 + 255);
  });
});
