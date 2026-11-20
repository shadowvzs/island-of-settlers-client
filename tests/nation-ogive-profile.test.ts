import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { ogiveMeshHeight } from "../src/render-common/buildings/nation-ogive-profile";
import { createNationOgiveDome } from "../src/renderers/three/buildings/nation-ogive-dome";

it.each([{ detailed: true }, { detailed: false }, { detailed: true, segments: 40 }, { detailed: false, segments: 16 }])(
  "matches actual ogive roof intersections and contacts: %j", ({ detailed, segments }) => {
  const geometry = createNationOgiveDome(detailed, segments), material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  for (const radius of [.1, .3, .48]) for (const angle of [.2, 1.1, 2.4]) {
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    const hits = new Raycaster(new Vector3(x, 2, z), new Vector3(0, -1, 0)).intersectObject(mesh);
    const height = ogiveMeshHeight(x, z, detailed, segments);
    if (height === null) expect(hits).toHaveLength(0);
    else {
      expect(hits.length).toBeGreaterThan(0); expect(hits[0]!.point.y).toBeCloseTo(height, 6);
      expect(roofTopAt([{ shape: "ogive-dome", stage: 3, surface: "roof", position: [0, 0, 0],
        size: [1, 1, 1], radialSegments: segments }], x, z, detailed)).toBeCloseTo(hits[0]!.point.y, 6);
    }
  }
  expect(ogiveMeshHeight(0, 0, detailed)).toBeCloseTo(.5);
  expect(ogiveMeshHeight(.6, 0, detailed)).toBeNull();
  geometry.dispose(); material.dispose();
});
