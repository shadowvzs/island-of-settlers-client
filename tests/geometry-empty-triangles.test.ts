import { BoxGeometry, BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2 } from "three";
import { expect, it } from "vitest";

import { removeEmptyTriangles } from "../src/renderers/three/buildings/geometry-empty-triangles";

it("removes collapsed lathe cap triangles while preserving its exact visible surface and bounds", () => {
  const geometry = new LatheGeometry([
    new Vector2(0, -.5), new Vector2(.4, -.5), new Vector2(.5, 0), new Vector2(.4, .5), new Vector2(0, .5)
  ], 6);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone(), positions = geometry.attributes.position!.array;
  const count = geometry.index!.count;
  removeEmptyTriangles(geometry);
  expect(geometry.index!.count).toBeLessThan(count);
  expect(geometry.attributes.position!.array).toBe(positions);
  expect(geometry.boundingBox).toEqual(bounds);
  geometry.dispose();
});

it("retains non-degenerate boxes and tiny nonzero faces without an arbitrary size cutoff", () => {
  const geometry = new BoxGeometry(1, 1, 1);
  const indices = geometry.index;
  removeEmptyTriangles(geometry);
  expect(geometry.index).toBe(indices);
  const tiny = new BufferGeometry();
  tiny.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1e-12, 0, 0, 0, 1e-12, 0], 3));
  removeEmptyTriangles(tiny);
  expect(tiny.index?.count ?? tiny.attributes.position!.count).toBe(3);
  geometry.dispose(); tiny.dispose();
});
