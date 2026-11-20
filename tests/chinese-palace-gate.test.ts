import { Euler, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { CHINESE_TIMBER } from "../src/render-common/buildings/chinese-building-roofs";
import { chineseMonumentRecipe } from "../src/render-common/buildings/chinese-monument";
import { CHINESE_GATE_CENTRES } from "../src/render-common/buildings/chinese-monument-podium";
import { monumentRecipe } from "../src/render-common/buildings/monument-definition";
import { createRomanOccupationRoof } from "../src/renderers/three/buildings/roman-occupation-roof";

it.each([true, false])("builds a closed central palace hall above five genuinely recessed gates (%s)", detailed => {
  const recipe = chineseMonumentRecipe(detailed), { parts, ...metadata } = recipe;
  const { parts: _originalParts, ...originalMetadata } = monumentRecipe();
  expect(metadata).toEqual(originalMetadata);
  expect(parts.filter(part => part.shape === "occupation-roof")).toHaveLength(1);
  expect(parts.some(part => part.topScale && part.size[1] > 1.5)).toBe(true);
  for (const centre of CHINESE_GATE_CENTRES) {
    const recessBlockers = parts.filter(part => {
      const { max, min } = getRomanPartBounds(part);
      return min[0] < centre + .28 && max[0] > centre - .28 && min[1] < 1.3 &&
        max[1] > .25 && min[2] < 1.9 && max[2] > 1.68;
    });
    expect(recessBlockers, `gate ${centre} has a real clear recess`).toEqual([]);
    expect(parts.some(part => part.position[0] === centre && part.position[2] === 1.445 &&
      part.size[0] === .79 && part.size[1] === 1.3)).toBe(true);
  }
  for (const part of parts) {
    const { max, min } = getRomanPartBounds(part);
    expect(min[0]).toBeGreaterThanOrEqual(-3.85);
    expect(max[0]).toBeLessThanOrEqual(3.85);
    expect(min[2]).toBeGreaterThanOrEqual(-3.38);
    expect(max[2]).toBeLessThanOrEqual(3.38);
    expect(part.size.every(value => Number.isFinite(value) && value > 0)).toBe(true);
  }
  const hall = parts.find(part => part.surface === "plaster" && part.size[0] > 6)!;
  expect(hall.position[1] - hall.size[1] / 2).toBeCloseTo(2.03);
  expect(hall.position[1] + hall.size[1] / 2).toBeGreaterThan(3.5);
  expect(parts.filter(part => part.shape === "occupation-roof")[0]!.surface).toBe("roof-slate");
});

it.each([true, false])("keeps every timber bearing below the actual tiled roof soffit (%s)", detailed => {
  const parts = chineseMonumentRecipe(detailed).parts;
  const part = parts.find(candidate => candidate.shape === "occupation-roof")!;
  const geometry = createRomanOccupationRoof(part, detailed), material = new MeshBasicMaterial();
  const roof = new Mesh(geometry, material);
  roof.position.fromArray(part.position); roof.scale.fromArray(part.size);
  roof.rotation.set(...part.rotation!, "ZYX"); roof.updateMatrixWorld(true);
  const framing = parts.filter(candidate => candidate.shape === "box" && candidate.tint?.[0] === CHINESE_TIMBER[0] &&
    candidate.position[1] > 3.5);
  expect(framing.length).toBeGreaterThan(20);
  for (const timber of framing) {
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...(timber.rotation ?? [0, 0, 0]), "ZYX"));
    matrix.setPosition(...timber.position);
    // Include edge and face middles: corner-only bounds miss a beam crossing a curved roof course.
    for (const x of [-.5, 0, .5]) for (const y of [-.5, 0, .5]) for (const z of [-.5, 0, .5]) {
      const vertex = new Vector3(x * timber.size[0], y * timber.size[1], z * timber.size[2])
        .applyMatrix4(matrix);
      const hit = new Raycaster(new Vector3(vertex.x, 8, vertex.z), new Vector3(0, -1, 0))
        .intersectObject(roof, false)[0];
      expect(hit, "every bearing stays within the actual roof plan").toBeDefined();
      expect(hit!.point.y - vertex.y, `soffit clearance at ${vertex.toArray().join(",")}`).toBeGreaterThan(.075);
    }
  }
  geometry.dispose(); material.dispose();
});
