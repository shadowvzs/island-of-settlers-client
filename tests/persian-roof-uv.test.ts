import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { persianDomeSegments } from "../src/render-common/buildings/persian-vault-profile";
import { applyPersianRoofUv } from "../src/renderers/three/buildings/persian-roof-uv";
import { createPersianBarrel, createPersianDome } from "../src/renderers/three/buildings/persian-vault";

it.each([true, false])("keeps dome courses continuous across every normal-axis boundary and meridian (%s)", detailed => {
  const geometry = createPersianDome(detailed), { radial, rows } = persianDomeSegments(detailed);
  const part: BuildingPart = { position: [0, 4.675, 0], shape: "persian-dome",
    size: [2.65, 1.65, 2.65], stage: 3, surface: "plaster", worldUv: .875 };
  geometry.scale(...part.size); expect(applyPersianRoofUv(geometry, part)).toBe(true);
  const uvs = geometry.getAttribute("uv"), stride = geometry.getAttribute("position").count / (radial + 1);
  for (let row = 1; row <= rows; row++) {
    const start = row, end = radial * stride + row;
    const span = uvs.getX(end) - uvs.getX(start);
    expect(span).toBeCloseTo(Math.round(span));
    expect(span).toBeGreaterThan(1);
    for (let column = 1; column <= radial; column++) {
      const index = column * stride + row;
      expect(uvs.getY(index)).toBeCloseTo(uvs.getY(start), 5);
      expect(uvs.getX(index) - uvs.getX(index - stride)).toBeCloseTo(span / radial, 5);
    }
  }
  geometry.dispose();
});

it.each([true, false])("unrolls the barrel continuously instead of switching projection at its shoulders (%s)", detailed => {
  const geometry = createPersianBarrel(detailed);
  const part: BuildingPart = { position: [0, 4, 2.15], shape: "persian-barrel",
    size: [2.9, 1.7, 3.9], stage: 3, surface: "plaster", worldUv: .875 };
  geometry.scale(...part.size); applyPersianRoofUv(geometry, part);
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv"); let checked = 0;
  for (let index = 0; index < positions.count; index++) {
    if (Math.abs(normals.getZ(index)) > .5) continue;
    expect(uvs.getX(index)).toBeCloseTo((positions.getZ(index) + part.position[2]) * .875, 5);
    expect(Number.isFinite(uvs.getY(index))).toBe(true); checked++;
  }
  expect(checked).toBeGreaterThan(30);
  geometry.dispose();
});
