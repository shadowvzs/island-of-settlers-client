import { DataTexture, MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { hasBuildingMaterialOwnership } from "../src/renderers/three/buildings/building-material-ownership";
import { createPersianAwningMaterial } from "../src/renderers/three/buildings/persian-awning-material";

it.each([true, false])("preserves woven stripe pigment without borrowing red albedo (%s)", detailed => {
  let pixels: ImageData | undefined;
  const canvas = { height: 0, width: 0, getContext: () => ({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (data: ImageData) => { pixels = data; }
  }) };
  vi.stubGlobal("document", { createElement: () => canvas });
  const red = new DataTexture(new Uint8Array([108, 55, 47, 255]), 1, 1);
  const normal = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const source = new MeshStandardMaterial({ color: 0x552211, map: red, normalMap: normal, vertexColors: true });
  const material = createPersianAwningMaterial(source, detailed), map = material.map!;
  const releaseMap = vi.fn(), releaseSource = vi.fn();
  map.addEventListener("dispose", releaseMap);
  red.addEventListener("dispose", releaseSource);
  expect(material.color.getHex()).toBe(0xffffff);
  expect(material.vertexColors).toBe(true);
  expect(material.map).not.toBe(source.map);
  expect(material.normalMap).toBe(normal);
  expect(source.color.getHex()).toBe(0x552211);
  expect(source.map).toBe(red);
  expect(hasBuildingMaterialOwnership(material)).toBe(true);
  const tones = new Set<number>();
  for (let at = 0; at < pixels!.data.length; at += 4) {
    const value = pixels!.data[at]!;
    expect(pixels!.data[at + 1]).toBe(value);
    expect(pixels!.data[at + 2]).toBe(value);
    expect(value).toBeGreaterThan(230);
    tones.add(value);
  }
  expect(tones.size).toBeGreaterThan(3);
  material.dispose();
  expect(releaseMap).toHaveBeenCalledTimes(1);
  expect(releaseSource).not.toHaveBeenCalled();
  source.dispose();
  red.dispose();
  normal.dispose();
});
