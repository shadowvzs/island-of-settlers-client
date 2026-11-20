import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createChinesePanCoverRoof }
  from "../src/renderers/three/buildings/chinese-pan-cover-roof";

it("keeps physical Chinese pans/covers opaque inside the original hip and pyramid roof box", () => {
  for (const profile of ["hip", "pyramid", "gable"] as const) for (const detailed of [true, false]) {
    const part: BuildingPart = { occupationRoof: profile, position: [0, 0, 0], roofSweep: .28,
      roofTiles: "pan-cover", shape: "occupation-roof", size: [2, .6, 2.6], stage: 3, surface: "roof" };
    const geometry = createChinesePanCoverRoof(part, detailed);
    const points = geometry.getAttribute("position");
    expect(Array.from(points.array).every(value => Number.isFinite(value) && Math.abs(value) <= .50001)).toBe(true);
    expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
    expect(geometry.index!.count / 3).toBeLessThan(detailed ? 4500 : 900);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.updateMatrixWorld();
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const hits = new Raycaster(new Vector3(x / 10, 1, z / 10), new Vector3(0, -1, 0))
        .intersectObject(mesh);
      expect(hits.length, `${profile}/${detailed}/${x}/${z}`).toBeGreaterThan(0);
      expect(hits[0]!.point.y).toBeGreaterThan(-.49);
    }
    mesh.material.dispose();geometry.dispose();
  }
});

it.each([true, false])("covers the half-hip eave kink with actual ceramic pans (%s)", detailed => {
  const part: BuildingPart = { occupationRoof: "half-hip", position: [0, 0, 0], roofSweep: .3,
    roofCurve: .62, roofTiles: "pan-cover", shape: "occupation-roof", size: [1.56, .45, 1.66],
    stage: 3, surface: "roof" };
  const geometry = createChinesePanCoverRoof(part, detailed);
  const positions = geometry.getAttribute("position"), colours = geometry.getAttribute("color");
  const indices = geometry.index!;
  const rows = Math.max(detailed ? 2 : 1, Math.min(detailed ? 7 : 1,
    Math.ceil(part.size[0] / 2 / (detailed ? .29 : .6))));
  const kink = .4 * 2.7 / 1.74;
  const row = Math.floor(kink * rows), q0 = Math.max(0, (row - .12) / rows), q1 = (row + 1) / rows;
  const q = (q0 + kink) / 2;
  const reach = (value: number) => Math.min(.5, .3 + value * .5 * 1.74 / 2.7);
  const chord = reach(q0) + (reach(q1) - reach(q0)) * (q - q0) / (q1 - q0);
  const z = (reach(q) + chord) / 2;
  try {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * q * .5, targetZ = sz * z;
      let covered = false;
      for (let index = 0; index < indices.count; index += 3) {
        const ids = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
        // Bedding, contact skirts and hip caps cannot satisfy a ceramic-pan coverage proof.
        if (!ids.every(id => colours.getX(id) >= .95)) continue;
        const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(positions, id));
        if (b!.clone().sub(a!).cross(c!.clone().sub(a!)).y < 1e-10) continue;
        const denominator = (b!.z - c!.z) * (a!.x - c!.x) + (c!.x - b!.x) * (a!.z - c!.z);
        const u = ((b!.z - c!.z) * (x - c!.x) + (c!.x - b!.x) * (targetZ - c!.z)) / denominator;
        const v = ((c!.z - a!.z) * (x - c!.x) + (a!.x - c!.x) * (targetZ - c!.z)) / denominator;
        if (Math.min(u, v, 1 - u - v) >= -1e-8) { covered = true; break; }
      }
      expect(covered, `actual pan at ${x}/${targetZ}`).toBe(true);
    }
  } finally { geometry.dispose(); }
});
