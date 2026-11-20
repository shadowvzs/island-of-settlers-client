import { BufferGeometry, Float32BufferAttribute, SRGBColorSpace, Texture } from "three";
import { expect, it } from "vitest";

import {
  createWisteriaBotanicalAtlas, mapWisteriaAtlasVertices,   WISTERIA_ATLAS_REGIONS,
wisteriaAtlasUV} from "../src/renderers/three/wisteria-botanical-atlas";
import { mapWisteriaFlowerAtlas, mapWisteriaLeafAtlas } from "../src/renderers/three/wisteria-botanical-atlas-geometry";
import { createWisteriaFlowerGeometry } from "../src/renderers/three/wisteria-flower-geometry";
import { createWisteriaLeafGeometry } from "../src/renderers/three/wisteria-leaf-geometry";

it("maps tight tissue regions upward without crossing adjacent atlas cells", () => {
  for (const surface of Object.keys(WISTERIA_ATLAS_REGIONS) as (keyof typeof WISTERIA_ATLAS_REGIONS)[]) {
    const lower = wisteriaAtlasUV(surface, 0, 0), upper = wisteriaAtlasUV(surface, 1, 1);
    expect(lower.every(value => value >= 0 && value <= 1)).toBe(true);
    expect(upper[0]).toBeGreaterThan(lower[0]);
    expect(upper[1]).toBeGreaterThan(lower[1]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 1, .2, .3], 2));
  mapWisteriaAtlasVertices(geometry, "banner", 0, 2, vertex => [vertex, vertex]);
  expect(geometry.getAttribute("uv").getX(0)).toBeCloseTo(wisteriaAtlasUV("banner", 0, 0)[0]);
  expect(geometry.getAttribute("uv").getY(2)).toBeCloseTo(.3);
  expect(() => mapWisteriaAtlasVertices(geometry, "banner", 2, 2, () => [0, 0])).toThrow("range");
  geometry.dispose();
});

it("owns one neutral texture and safely ignores a late load after final owner disposal", () => {
  const texture = new Texture();
  let ready: (value: Texture) => void = () => {}, failed = () => {}, disposed = 0;
  texture.addEventListener("dispose", () => { disposed++; });
  const atlas = createWisteriaBotanicalAtlas((url, loaded, failure) => {
    expect(url).toContain("wisteria-neutral-atlas-candidate.png");
    ready = loaded; failed = failure; return texture;
  });
  expect(atlas.texture.colorSpace).toBe(SRGBColorSpace);
  expect(atlas.state()).toEqual({ ready: false, failed: false, disposed: false });
  atlas.dispose(); atlas.dispose();
  texture.image = { late: true }; ready(texture); failed();
  expect(disposed).toBe(1);
  expect(texture.image).toBeNull();
  expect(atlas.state()).toEqual({ ready: false, failed: false, disposed: true });
});

it("reuses the unchanged curved flower and leaflet topology with tissue-specific UVs", () => {
  const flower = createWisteriaFlowerGeometry(), leaf = createWisteriaLeafGeometry();
  const vertices = Array.from(flower.petals.getAttribute("position").array);
  const leafVertices = Array.from(leaf.getAttribute("position").array);
  mapWisteriaFlowerAtlas(flower.petals); mapWisteriaLeafAtlas(leaf);
  expect(Array.from(flower.petals.getAttribute("position").array)).toEqual(vertices);
  expect(Array.from(leaf.getAttribute("position").array)).toEqual(leafVertices);
  for (const geometry of [flower.petals, leaf]) {
    const uv = geometry.getAttribute("uv");
    expect(Array.from(uv.array).every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  }
  const uv = flower.petals.getAttribute("uv");
  expect(uv.getX(0)).toBeLessThan(.5);
  expect(uv.getX(9)).toBeGreaterThan(.5);
  flower.dispose(); leaf.dispose();
});
