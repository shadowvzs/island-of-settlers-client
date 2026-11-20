import { Box3, type BufferGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { buildBlade } from "../src/renderers/three/military-equipment-blades";
import { buildArrow, buildBow } from "../src/renderers/three/military-equipment-bows";
import { countTriangles } from "../src/renderers/three/military-equipment-mesh";
import { buildShield } from "../src/renderers/three/military-equipment-shields";
import { buildTwoHanded } from "../src/renderers/three/military-equipment-two-handed";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese"];
/** Triangle budgets per item (docs/contracts/settlement-military-contract.md): [High, Minimal]. */
const BUDGETS = {
  arrow: [60, 16], blade: [380, 70], bow: [300, 50], shield: [420, 50], twoHanded: [450, 80]
} as const;

interface Item { budget: keyof typeof BUDGETS; geometry: BufferGeometry; id: string }
const items = (detailed: boolean): Item[] => NATIONS.flatMap((nation): Item[] => [
  { budget: "shield", geometry: buildShield(nation, detailed), id: `${nation} shield` },
  { budget: "twoHanded", geometry: buildTwoHanded(nation, detailed), id: `${nation} two-handed` },
  { budget: "bow", geometry: buildBow(nation, detailed), id: `${nation} bow` },
  ...(["infantry", "cavalry"] as const).map((kind): Item =>
    ({ budget: "blade", geometry: buildBlade(nation, kind, detailed), id: `${nation} ${kind} blade` }))
]);

const bounds = (geometry: BufferGeometry) => new Box3().setFromBufferAttribute(
  geometry.getAttribute("position") as never);

/** Share of triangles whose normal faces away from the item's centre (closed, outward shells). */
const outwardShare = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position"), index = geometry.index!;
  const centre = bounds(geometry).getCenter(new Vector3());
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  let outward = 0;
  for (let face = 0; face < index.count; face += 3) {
    a.fromBufferAttribute(position, index.getX(face));
    b.fromBufferAttribute(position, index.getX(face + 1));
    c.fromBufferAttribute(position, index.getX(face + 2));
    const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const middle = a.clone().add(b).add(c).divideScalar(3).sub(centre);
    if (normal.dot(middle) >= 0) outward++;
  }
  return outward / (index.count / 3);
};

/** Whether a slim grip or haft (triangles within `radius` of the Y axis) spans height `y`. */
const gripsAt = (geometry: BufferGeometry, y: number, radius = .035) => {
  const position = geometry.getAttribute("position"), index = geometry.index!;
  for (let face = 0; face < index.count; face += 3) {
    const corners = [0, 1, 2].map(corner => new Vector3().fromBufferAttribute(position, index.getX(face + corner)));
    const heights = corners.map(corner => corner.y);
    if (Math.min(...heights) > y || Math.max(...heights) < y) continue;
    if (corners.every(corner => Math.hypot(corner.x, corner.z) < radius)) return true;
  }
  return false;
};

describe("nation military equipment", () => {
  it("keeps every item within its High and Minimal triangle budget", () => {
    for (const [lod, detailed] of [[0, true], [1, false]] as const)
      for (const item of [...items(detailed), { budget: "arrow" as const, geometry: buildArrow(detailed),
        id: "arrow" }])
        expect(countTriangles(item.geometry), `${item.id} ${detailed ? "High" : "Minimal"}`)
          .toBeLessThanOrEqual(BUDGETS[item.budget][lod]);
  });

  it("bakes colour, surface and atlas UVs for the shared material", () => {
    for (const item of items(false)) {
      for (const name of ["color", "equipmentSurface", "uv", "normal"])
        expect(item.geometry.getAttribute(name), `${item.id} ${name}`).toBeTruthy();
      const uv = item.geometry.getAttribute("uv");
      for (let index = 0; index < uv.count; index++) {
        expect(uv.getX(index)).toBeGreaterThanOrEqual(0); expect(uv.getX(index)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts a grip under every hand: the origin, and 0.15 lower (the spear: 0.28 ahead) on two-handed ones", () => {
    for (const nation of NATIONS)
      for (const detailed of [true, false]) {
        for (const kind of ["infantry", "cavalry"] as const) {
          const blade = buildBlade(nation, kind, detailed);
          expect(gripsAt(blade, 0), `${nation} ${kind}`).toBe(true);
          expect(bounds(blade).max.y, `${nation} ${kind} blade length`).toBeGreaterThan(.18);
        }
        const twoHanded = buildTwoHanded(nation, detailed);
        for (const hand of [0, nation === "nubian" ? .28 : -.15])
          expect(gripsAt(twoHanded, hand), `${nation} two-handed ${hand}`).toBe(true);
        expect(bounds(twoHanded).max.y, `${nation} two-handed reach`).toBeGreaterThan(.55);
      }
  });

  it("leads with the edge or bit towards +X", () => {
    expect(bounds(buildTwoHanded("viking", true)).max.x).toBeGreaterThan(.15);
    expect(bounds(buildBlade("nubian", "infantry", true)).max.x).toBeGreaterThan(.1);
  });

  it("holds shields in front of the gripping hand, face towards +Z", () => {
    for (const nation of NATIONS)
      for (const detailed of [true, false]) {
        const box = bounds(buildShield(nation, detailed));
        expect(box.min.z).toBeGreaterThan(.015);
        expect(box.max.y - box.min.y).toBeGreaterThan(.44);
      }
  });

  it("faces its triangles outwards so single-sided shading stays lit", () => {
    for (const nation of NATIONS)
      for (const detailed of [true, false])
        expect(outwardShare(buildShield(nation, detailed)), nation).toBeGreaterThan(.7);
    for (const nation of ["roman", "viking"] as const)
      expect(outwardShare(buildBlade(nation, "infantry", true)), nation).toBeGreaterThan(.7);
  });
});
