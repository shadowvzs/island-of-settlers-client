import { expect, it, vi } from "vitest";

import { createOrnamentalWoodGeometry } from "../src/renderers/three/plants/ornamental-wood-geometry";
import { createPeachWoodGeometry } from "../src/renderers/three/plants/peach-bark-geometry";
import { createPeachBarkTextures, peachBarkRelief } from "../src/renderers/three/plants/peach-bark-textures";

it("distinguishes warm young lenticelled wood from mature grey-red fissured peach bark", () => {
  const pack = createPeachBarkTextures();
  const pixels = pack.map.image.data as Uint8Array, width = pack.map.image.width;
  const youngPixels = pack.youngMap.image.data as Uint8Array, youngWidth = pack.youngMap.image.width;
  let oldContrast = 0, youngContrast = 0, count = 0;
  for (let y = 0; y < 512; y += 8) for (let x = 0; x < 256; x += 8) {
    const old = (y * width + x) * 4, young = ((y % 256) * youngWidth + x % youngWidth) * 4;
    oldContrast += pixels[old]! - pixels[old + 1]!;
    youngContrast += youngPixels[young]! - youngPixels[young + 1]!; count++;
  }
  expect(youngContrast / count).toBeGreaterThan(oldContrast / count + 20);
  const normalPixels = pack.normalMap.image.data as Uint8Array;
  expect(normalPixels.some((value, index) => index % 4 === 0 && Math.abs(value - 128) > 3)).toBe(true);
  const mapReleased = vi.fn(), normalReleased = vi.fn();
  pack.map.addEventListener("dispose", mapReleased); pack.normalMap.addEventListener("dispose", normalReleased);
  pack.dispose(); pack.dispose();
  expect(mapReleased).toHaveBeenCalledTimes(1); expect(normalReleased).toHaveBeenCalledTimes(1);
});

it("uses full UV width for both age materials and keeps bark scale in world metres", () => {
  const old = createPeachWoodGeometry({ parent: null, role: "trunk", radius: .28, tipRadius: .08,
    path: [[0, 0, 0], [0, 2.5, 0], [0, 5, 0]] }, true, 0);
  const young = createPeachWoodGeometry({ parent: 0, role: "twig", radius: .005, tipRadius: .001,
    path: [[0, 0, 0], [.15, 0, 0], [.30, 0, 0]] }, true, 0);
  try {
    const oldUv = old.getAttribute("uv"), youngUv = young.getAttribute("uv");
    const oldU = Array.from({ length: oldUv.count }, (_, index) => oldUv.getX(index));
    const youngU = Array.from({ length: youngUv.count }, (_, index) => youngUv.getX(index));
    expect(Math.max(...oldU)).toBeCloseTo(1); expect(Math.min(...oldU)).toBe(0);
    expect(Math.max(...youngU)).toBeGreaterThan(.6); expect(Math.min(...youngU)).toBe(0);
    expect(Math.max(...Array.from({ length: oldUv.count }, (_, index) => oldUv.getY(index)))).toBeCloseTo(5, 5);
    expect(Math.max(...Array.from({ length: youngUv.count }, (_, index) => youngUv.getY(index)))).toBeCloseTo(.3, 5);
  } finally { old.dispose(); young.dispose(); }
});

it("adds bounded physical mature-bark relief without extra triangles or moving limb bearings", () => {
  const limb = { parent: null, role: "trunk" as const, radius: .28, tipRadius: .08,
    path: [[0, 0, 0], [0, 2.5, 0], [0, 5, 0]] as [number, number, number][] };
  const original = createOrnamentalWoodGeometry(limb, true, 0);
  const peach = createPeachWoodGeometry(limb, true, 0);
  try {
    expect(peach.index!.count).toBe(original.index!.count);
    const source = original.getAttribute("position"), changed = peach.getAttribute("position");
    const uv = original.getAttribute("uv");
    let maximumV = 0;
    for (let i = 0; i < uv.count; i++) maximumV = Math.max(maximumV, uv.getY(i));
    let moved = 0;
    for (let i = 0; i < source.count; i++) {
      const distance = Math.hypot(changed.getX(i) - source.getX(i), changed.getY(i) - source.getY(i),
        changed.getZ(i) - source.getZ(i));
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeLessThan(.007);
      if (uv.getY(i) === 0 || uv.getY(i) === maximumV || i >= source.count - 28)
        expect(distance).toBe(0);
      moved += Number(distance > .0001);
    }
    expect(moved).toBeGreaterThan(50);
  } finally { original.dispose(); peach.dispose(); }
});

it("keeps mature relief locally continuous through plate ownership boundaries", () => {
  let jump = 0, minimum = Infinity, maximum = -Infinity;
  for (let row = 0; row < 13; row++) for (let column = 0; column < 2048; column++) {
    const u = column / 2048, v = row / 13;
    const before = peachBarkRelief(u - .000001, v), after = peachBarkRelief(u + .000001, v);
    jump = Math.max(jump, Math.abs(before - after)); minimum = Math.min(minimum, before);
    maximum = Math.max(maximum, after);
  }
  expect(jump).toBeLessThan(.0002);
  expect(maximum - minimum).toBeGreaterThan(.04);
});
