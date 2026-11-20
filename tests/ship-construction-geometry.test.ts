import { BoxGeometry, Vector3 } from "three";
import { expect, it } from "vitest";

import { sliceShipGeometry } from "../src/renderers/three/settlement/ship-construction-geometry";

it("builds clean keel-to-deck courses without losing or duplicating completed hull surfaces", () => {
  const hull = new BoxGeometry(2, 2, 4);
  const slices = sliceShipGeometry(hull, 10, "y", value => value);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let area = 0;
  for (const [index, slice] of slices.entries()) {
    const position = slice.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex++) {
      expect(position.getY(vertex)).toBeGreaterThanOrEqual(-1 + index * .2 - 1e-6);
      expect(position.getY(vertex)).toBeLessThanOrEqual(-1 + (index + 1) * .2 + 1e-6);
    }
    for (let triangle = 0; triangle < position.count; triangle += 3) {
      a.fromBufferAttribute(position, triangle); b.fromBufferAttribute(position, triangle + 1);
      c.fromBufferAttribute(position, triangle + 2);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    slice.dispose();
  }
  expect(area).toBeCloseTo(40, 5);
  hull.dispose();
});

it("fits sail sections downward from their attachment height, rather than sideways scraps", () => {
  const sail = new BoxGeometry(2, 4, .01);
  const slices = sliceShipGeometry(sail, 4, "y", value => value, true);
  for (const [index, slice] of slices.entries()) {
    slice.computeBoundingBox();
    expect(slice.boundingBox!.min.y).toBeCloseTo(1 - index);
    expect(slice.boundingBox!.max.y).toBeCloseTo(2 - index);
    slice.dispose();
  }
  sail.dispose();
});
