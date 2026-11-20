import { Color, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { createBodyMaterials, tintColourKey } from "../src/renderers/three/worker-body-materials";
import { CrowdBodyMaterial } from "../src/renderers/three/worker-crowd-body";

it("keys the same colour consistently as a string, hex number or Color", () => {
  expect(tintColourKey("#2F5BC4")).toBe(tintColourKey(0x2f5bc4));
  expect(tintColourKey(new Color(0x2f5bc4))).toBe(tintColourKey("2f5bc4"));
  expect(tintColourKey(0x2f5bc4)).toBe("#2f5bc4");
});

it("shares untinted materials and one tint variant per colour", () => {
  const materials = createBodyMaterials();
  const plain = new MeshStandardMaterial();
  expect(materials.get(plain, "#ff0000")).toBe(plain);
  const tunic = new MeshStandardMaterial();
  tunic.name = "tunic_team_linen";
  const red = materials.get(tunic, "#ff0000") as MeshStandardMaterial;
  expect(red).not.toBe(tunic);
  expect(red.color.getHexString()).toBe("ff0000");
  expect(materials.get(tunic, "#ff0000")).toBe(red);
  const blue = materials.get(tunic, "#0000ff") as MeshStandardMaterial;
  expect(blue).not.toBe(red);
  expect(blue.color.getHexString()).toBe("0000ff");
  // A variant resolves back to its loaded source, so later colour changes keep sharing.
  expect(materials.get(red, "#00ff00")).toBe(materials.get(tunic, "#00ff00"));
  materials.dispose();
});

it("tints the merged crowd body through its tint colour", () => {
  const materials = createBodyMaterials();
  const crowd = new CrowdBodyMaterial();
  const green = materials.get(crowd, "#00ff00") as CrowdBodyMaterial;
  expect(green).not.toBe(crowd);
  expect(green.tint.getHexString()).toBe("00ff00");
  expect(materials.get(green, "#0000ff")).toBe(materials.get(crowd, "#0000ff"));
  materials.dispose();
});
