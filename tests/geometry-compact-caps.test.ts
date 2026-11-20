import { CircleGeometry, CylinderGeometry, Vector3 } from "three";
import { expect, it } from "vitest";

import { compactPrimitiveCaps } from "../src/renderers/three/buildings/geometry-compact-caps";

const area = (geometry: CylinderGeometry | CircleGeometry) => {
  const positions = geometry.attributes.position!, index = geometry.index!;
  let sum = 0;
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = new Vector3().fromBufferAttribute(positions, index.getX(offset));
    const b = new Vector3().fromBufferAttribute(positions, index.getX(offset + 1));
    const c = new Vector3().fromBufferAttribute(positions, index.getX(offset + 2));
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
};

it.each([3, 4, 6, 12])("retains exact cap coverage, normals and UVs with %s-sided cylinders", segments => {
  const geometry = new CylinderGeometry(.5, .5, 1, segments);
  const before = area(geometry), count = geometry.index!.count, attributes = { ...geometry.attributes };
  compactPrimitiveCaps(geometry);
  expect(geometry.index!.count).toBe(count - 12);
  expect(area(geometry)).toBeCloseTo(before, 10);
  expect(geometry.attributes.position).toBe(attributes.position);
  expect(geometry.attributes.normal).toBe(attributes.normal);
  expect(geometry.attributes.uv).toBe(attributes.uv);
  for (const group of geometry.groups.filter(group => group.materialIndex !== 0)) {
    const expected = group.materialIndex === 1 ? 1 : -1;
    const position = geometry.attributes.position!;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const a = new Vector3().fromBufferAttribute(position, geometry.index!.getX(offset));
      const b = new Vector3().fromBufferAttribute(position, geometry.index!.getX(offset + 1));
      const c = new Vector3().fromBufferAttribute(position, geometry.index!.getX(offset + 2));
      expect(Math.sign(b.sub(a).cross(c.sub(a)).y)).toBe(expected);
    }
  }
  geometry.dispose();
});

it("retains a complete flat painted disc while avoiding changes to partial arcs", () => {
  const disc = new CircleGeometry(.5, 8), before = area(disc);
  compactPrimitiveCaps(disc);
  expect(disc.index!.count / 3).toBe(6);
  expect(area(disc)).toBeCloseTo(before, 10);
  const partial = new CylinderGeometry(.5, .5, 1, 6, 1, false, 0, Math.PI);
  const index = partial.index;
  compactPrimitiveCaps(partial);
  expect(partial.index).toBe(index);
  disc.dispose(); partial.dispose();
});
