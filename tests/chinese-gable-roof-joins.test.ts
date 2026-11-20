import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { addChineseRoof } from "../src/render-common/buildings/chinese-building-roofs";
import { chineseRoofSoffit } from "../src/render-common/buildings/chinese-roof-bearings";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { getOccupationRoofHeight } from "../src/render-common/buildings/occupation-roof-height";
import { createChinesePanCoverRoof } from "../src/renderers/three/buildings/chinese-pan-cover-roof";

it.each([true, false])("keeps the swept gable ridge on the clamped roof surface (%s)", detailed => {
  const parts: BuildingPart[] = [];
  addChineseRoof(part => parts.push({ ...part, stage: part.stage ?? 0 }),
    { min: [-1, 1, -1.3], max: [1, 1.2, 1.3] }, 17, detailed);
  const roof = parts.find(part => part.shape === "occupation-roof")!;
  const beams = parts.filter(part => part.shape === "bevel-box" && part.stage === 4 &&
    part.size[0] === .065 && part.size[1] === .065);
  expect(beams).toHaveLength(detailed ? 6 : 4);
  const geometry = createChinesePanCoverRoof(roof, detailed);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.position.fromArray(roof.position);
  mesh.rotation.fromArray(roof.rotation ?? [0, 0, 0]);
  mesh.scale.fromArray(roof.size);
  mesh.updateMatrixWorld();
  for (const beam of beams) {
    const z = (beam.position[2] - roof.position[2]) / roof.size[2];
    const surface = Math.min(.495, getOccupationRoofHeight("gable", 0, z, roof.roofSweep, roof.roofCurve));
    const expected = roof.position[1] + surface * roof.size[1] + .018;
    // The straight segment may chord the curve, but the roof must intersect its half-height.
    expect(Math.abs(beam.position[1] - expected)).toBeLessThan(beam.size[1] / 2);
    const hits = new Raycaster(new Vector3(beam.position[0], beam.position[1] + .2, beam.position[2]),
      new Vector3(0, -1, 0)).intersectObject(mesh);
    expect(hits.some(hit => Math.abs(beam.position[1] - hit.point.y) < beam.size[1] / 2)).toBe(true);
  }
  geometry.dispose();
  material.dispose();
});

it.each([[1, true], [1, false], [5, true], [5, false]] as const)(
  "bears the woodcutter roof on its wall plates (level %i, detailed %s)", (level, detailed) => {
  const parts = leveledBuildingRecipe(getBuildingDefinition(17), "chinese", detailed, level).parts;
  const roof = parts.find(part => part.shape === "occupation-roof" && part.occupationRoof === "gable")!;
  const posts = parts.filter(part => part.roofSupport && !part.rotation && part.size[0] === .06 &&
    part.size[2] === .06);
  expect(posts.length).toBeGreaterThanOrEqual(4);
  for (const post of posts) {
    const top = post.position[1] + post.size[1] / 2;
    const bottom = post.position[1] - post.size[1] / 2;
    expect(top).toBeCloseTo(chineseRoofSoffit(roof, post.position[0], post.position[2], detailed)! + .005, 5);
    const plate = parts.find(part => part !== post && part.surface === "paint" && !part.roofSupport &&
      Math.abs(part.position[1] + part.size[1] / 2 - bottom - .005) < 1e-5 &&
      Math.abs(part.position[0] - post.position[0]) <= part.size[0] / 2 &&
      Math.abs(part.position[2] - post.position[2]) <= part.size[2] / 2);
    expect(plate).toBeDefined();
  }
});

it.each([true, false])("seats each woodcutter ridge segment on its actual roof mesh (%s)", detailed => {
  const parts = leveledBuildingRecipe(getBuildingDefinition(17), "chinese", detailed, 1).parts;
  const roof = parts.find(part => part.shape === "occupation-roof" && part.occupationRoof === "gable")!;
  const beams = parts.filter(part => part.shape === "bevel-box" && part.stage === 4 &&
    part.size[0] === .065 && part.size[1] === .065);
  expect(beams.length).toBeGreaterThan(0);
  const geometry = createChinesePanCoverRoof(roof, detailed);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.position.fromArray(roof.position);
  mesh.rotation.set(...(roof.rotation ?? [0, 0, 0]));
  mesh.scale.fromArray(roof.size);
  mesh.updateMatrixWorld();
  for (const beam of beams) {
    const hits = new Raycaster(new Vector3(beam.position[0], beam.position[1] + .2, beam.position[2]),
      new Vector3(0, -1, 0)).intersectObject(mesh);
    expect(hits.some(hit => Math.abs(beam.position[1] - hit.point.y) < beam.size[1] / 2)).toBe(true);
  }
  geometry.dispose();
  material.dispose();
});

it.each([[1, true], [1, false], [5, true], [5, false]] as const)(
  "keeps every Chinese gable mesh finite and its ridge seated (level %i, detailed %s)", (level, detailed) => {
    let checked = 0;
    for (const definition of BUILDING_CATALOG) {
      const parts = leveledBuildingRecipe(definition, "chinese", detailed, level).parts;
      for (const roof of parts.filter(part => part.shape === "occupation-roof" &&
        part.occupationRoof === "gable" && part.roofTiles === "pan-cover")) {
        checked++;
        const geometry = createChinesePanCoverRoof(roof, detailed);
        const label = `${definition.id}/${level}/${detailed}`;
        for (const attribute of ["position", "normal", "color", "uv"]) {
          expect(Array.from(geometry.getAttribute(attribute).array).every(Number.isFinite),
            `${label}/${attribute}`).toBe(true);
        }
        const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material);
        mesh.position.fromArray(roof.position);
        mesh.rotation.set(...(roof.rotation ?? [0, 0, 0]));
        mesh.scale.fromArray(roof.size);
        mesh.updateMatrixWorld();
        const yaw = roof.rotation?.[1] ?? 0;
        const beams = parts.filter(part => {
          if (roof.architecture || part.shape !== "bevel-box" || part.stage !== 4 ||
            part.size[0] !== .065 || part.size[1] !== .065) return false;
          const dx = part.position[0] - roof.position[0], dz = part.position[2] - roof.position[2];
          const u = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
          const v = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
          const height = Math.min(.495, getOccupationRoofHeight("gable", 0, v / roof.size[2],
            roof.roofSweep, roof.roofCurve));
          const ridgeY = roof.position[1] + height * roof.size[1] + .018;
          if (Math.abs(u) >= .01 || Math.abs(v) >= roof.size[2] * .5) return false;
          const distance = Math.abs(part.position[1] - ridgeY);
          return !parts.some(other => {
            if (other === roof || other.shape !== "occupation-roof" || other.occupationRoof !== "gable") return false;
            const otherYaw = other.rotation?.[1] ?? 0;
            const ox = part.position[0] - other.position[0], oz = part.position[2] - other.position[2];
            const across = Math.cos(otherYaw) * ox - Math.sin(otherYaw) * oz;
            const along = Math.sin(otherYaw) * ox + Math.cos(otherYaw) * oz;
            if (Math.abs(across) >= .01 || Math.abs(along) >= other.size[2] * .5) return false;
            const otherHeight = Math.min(.495, getOccupationRoofHeight("gable", 0, along / other.size[2],
              other.roofSweep, other.roofCurve));
            return Math.abs(part.position[1] - (other.position[1] + otherHeight * other.size[1] + .018)) < distance;
          });
        });
        if (!roof.architecture) expect(beams.length, `${label}/ridge`).toBeGreaterThan(0);
        for (const beam of beams) {
          const ray = new Raycaster(new Vector3(beam.position[0], beam.position[1] + .2, beam.position[2]),
            new Vector3(0, -1, 0));
          const hits = ray.intersectObject(mesh);
          expect(hits.some(hit => Math.abs(beam.position[1] - hit.point.y) < beam.size[1] / 2),
            `${label}/ridge at ${beam.position.join(",")}`).toBe(true);
        }
        geometry.dispose();
        material.dispose();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
