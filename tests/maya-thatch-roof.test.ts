import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createMayaThatchRoof } from "../src/renderers/three/buildings/maya-thatch-roof";
import { createRoofEndInfill } from "../src/renderers/three/buildings/roman-occupation-roof";

it.each(["hip", "half-hip"] as const)("keeps thick %s thatch closed and inside its original roof box", profile => {
  const part: BuildingPart = { occupationRoof: profile, position: [0, 0, 0],
    shape: "occupation-roof", size: [5, 1, 5], stage: 3, surface: "straw" };
  for (const detailed of [true, false]) {
    const geometry = createMayaThatchRoof(part, detailed);
    geometry.computeBoundingBox();
    for (const axis of ["x", "y", "z"] as const) {
      expect(geometry.boundingBox!.min[axis]).toBeGreaterThanOrEqual(-.50001);
      expect(geometry.boundingBox!.max[axis]).toBeLessThanOrEqual(.50001);
    }
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    for (const x of [-.43, -.21, .13, .39]) for (const z of [-.41, -.17, .23, .38]) {
      const hits = new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(mesh);
      expect(hits.length, `${detailed}/${x}/${z}`).toBeGreaterThanOrEqual(2);
      expect(hits[0]!.point.y - hits.at(-1)!.point.y).toBeGreaterThanOrEqual(.1299);
    }
    const triangles = geometry.getAttribute("position").count / 3;
    expect(triangles).toBeLessThan(detailed ? 4500 : 400);
    geometry.dispose(); material.dispose();
  }
});

it("closes the raised half-hip end above the wall instead of leaving an open attic slit", () => {
  const part: BuildingPart = { occupationRoof: "half-hip", position: [0, 0, 0],
    roofInfillRatio: [.96, .96], shape: "roof-infill", size: [1, 1, 1], stage: 2, surface: "straw" };
  for (const detailed of [true, false]) {
    const geometry = createRoofEndInfill(part, detailed);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    for (const x of [-.15, .05, .18]) {
      const hits = new Raycaster(new Vector3(x, -.26, 1), new Vector3(0, 0, -1)).intersectObject(mesh);
      expect(hits.length).toBeGreaterThanOrEqual(2);
    }
    geometry.dispose(); material.dispose();
  }
});

it.each([["hip", true], ["hip", false], ["half-hip", true], ["half-hip", false]] as const)(
  "uses closed outward straw strands over all pitches with lean geometry (%s/%s)", (profile, detailed) => {
  const part: BuildingPart = { occupationRoof: profile, position: [0, 0, 0],
    shape: "occupation-roof", size: [2, .8, 2], stage: 3, surface: "straw" };
  const geometry = createMayaThatchRoof(part, detailed), positions = geometry.getAttribute("position");
  const metadata = geometry.userData.thatch;
  expect(metadata.alphaCards).toBe(false);
  expect(metadata.fieldStrands).toBeGreaterThan(detailed ? 50 : 5);
  const stride = (detailed ? 14 : 8) * 3;
  expect(positions.count - metadata.coreVertices).toBe(metadata.strands * stride);
  let coreExtent = 0, looseExtent = 0;
  const looseTipHeights = new Set<number>();
  for (let at = 0; at < metadata.coreVertices; at++)
    coreExtent = Math.max(coreExtent, Math.abs(positions.getX(at)), Math.abs(positions.getZ(at)));
  for (let at = metadata.coreVertices + metadata.fieldStrands * stride; at < positions.count; at++) {
    const extent = Math.max(Math.abs(positions.getX(at)), Math.abs(positions.getZ(at)));
    looseExtent = Math.max(looseExtent, extent);
    if (extent > coreExtent + .015) looseTipHeights.add(Math.round(positions.getY(at) * 1000));
  }
  expect(looseExtent - coreExtent, "loose bundles must extend beyond the straight opaque fascia").toBeGreaterThan(.025);
  expect(looseTipHeights.size, "visible eave tips must end at varied heights").toBeGreaterThan(10);
  let lifted = 0;
  const quadrants = new Set<string>();
  for (let start = metadata.coreVertices; start < positions.count; start += stride) {
    const edges = new Map<string, number>();
    let signedVolume = 0;
    const point = (at: number) => [positions.getX(at), positions.getY(at), positions.getZ(at)]
      .map(value => Math.round(value * 1e7)).join(",");
    for (let at = start; at < start + stride; at += 3) {
      const a = new Vector3().fromBufferAttribute(positions, at);
      const b = new Vector3().fromBufferAttribute(positions, at + 1);
      const c = new Vector3().fromBufferAttribute(positions, at + 2);
      signedVolume += a.dot(b.cross(c)) / 6;
      const corners = [point(at), point(at + 1), point(at + 2)];
      for (let edge = 0; edge < 3; edge++) {
        const key = [corners[edge]!, corners[(edge + 1) % 3]!]
          .sort((a, b) => a.localeCompare(b)).join("/");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2), `closed strand ${start}`).toBe(true);
    expect(signedVolume, `outward strand ${start}`).toBeGreaterThan(0);
    for (let at = start; at < start + stride; at++) {
      const x = positions.getX(at), y = positions.getY(at), z = positions.getZ(at);
      if (Math.abs(x) > .46 || Math.abs(z) > .46) continue;
      const expected = .06 + .86 * Math.min(.43 - 1.74 * Math.abs(x / .978),
        .43 - (profile === "half-hip" ? 2.7 : 4.35) * Math.max(0, Math.abs(z / .978) - .3));
      if (y > expected + .002) {
        lifted++; quadrants.add(`${Math.sign(x)}/${Math.sign(z)}`);
      }
    }
  }
  expect(lifted).toBeGreaterThan(20);
  expect(quadrants.size).toBe(4);
  expect(positions.count / 3).toBeLessThan(detailed ? 4500 : 400);
  expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
  const normal = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
  let texturedCutFaces = 0;
  const cutHeights: number[] = [];
  for (let at = 0; at < metadata.coreVertices; at += 3) {
    const ys = [0, 1, 2].map(corner => positions.getY(at + corner));
    if (Math.abs(normal.getY(at)) > .01 || Math.max(...ys) - Math.min(...ys) < .08) continue;
    const vs = [0, 1, 2].map(corner => uv.getY(at + corner));
    expect(Math.max(...vs) - Math.min(...vs), "cut eave must not stretch one atlas row").toBeGreaterThan(.01);
    texturedCutFaces++;
    cutHeights.push(...ys.filter(y => y < -.41));
  }
  expect(texturedCutFaces).toBeGreaterThan(10);
  expect(Math.max(...cutHeights) - Math.min(...cutHeights), "physically ragged underside").toBeGreaterThan(.012);
  geometry.dispose();
});
