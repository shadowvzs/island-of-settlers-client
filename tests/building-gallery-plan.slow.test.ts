import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { GALLERY_NATIONS,galleryCaseKey, galleryCoverage, galleryOptions } from "../tools/bench/building-gallery-plan";

it("keeps every requested national type, LOD and level explicit without promoting partial coverage", () => {
  const full = galleryCoverage("full", ["front", "rear"]);
  expect(full.cases).toHaveLength(BUILDING_CATALOG.length * 8 * 2 * 5);
  expect(full.completeAllLevels).toBe(true);
  expect(full.omitted).toEqual([]);
  const fullKeys = new Set(full.cases.map(galleryCaseKey));
  expect(fullKeys.size).toBe(full.cases.length);
  for (const nation of GALLERY_NATIONS) for (const quality of ["high", "minimal"] as const)
    for (const building of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as const)
      expect(fullKeys.has(galleryCaseKey({ id: building.id, level, name: building.name, nation, quality }))).toBe(true);
  for (const mode of ["base", "initial"] as const) {
    const partial = galleryCoverage(mode, ["front", "rear"]);
    expect(partial.baseVariants).toBe(BUILDING_CATALOG.length * 8 * 2);
    expect(partial.completeAllLevels).toBe(false);
    const selected = new Set(partial.cases.map(galleryCaseKey));
    expect(partial.omitted.every(entry => !selected.has(galleryCaseKey(entry)))).toBe(true);
    expect(new Set([...partial.cases, ...partial.omitted].map(galleryCaseKey))).toEqual(fullKeys);
    expect(partial.frames).toBe(partial.variants * 2);
    expect(partial.fullRequestedFrames).toBe(full.frames);
    expect(partial.cases.every(entry => entry.level === 1 || mode === "initial" && entry.level === 5)).toBe(true);
  }
});

it("rejects unsafe output IDs and unsupported modes/views before creating any output", () => {
  expect(() => galleryOptions(["--run=../../assets"])).toThrow("Use a fresh simple run ID");
  expect(() => galleryOptions(["--mode=accepted"])).toThrow("Unknown coverage mode");
  expect(() => galleryOptions(["--views=front,front"])).toThrow("Unknown or repeated view");
  expect(() => galleryOptions(["--publish"])).toThrow("Unknown gallery argument");
  expect(galleryOptions(["--prepare", "--mode=full", "--views=front,rear,interior"]).prepare).toBe(true);
});
