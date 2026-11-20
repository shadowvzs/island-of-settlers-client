import { BoxGeometry, Group, Mesh, TorusGeometry } from "three";
import { expect, it } from "vitest";

import { intersectMeshSurfaces, meshSurface, objectIsVisible } from "../tools/bench/mesh-clearance";

it("detects actual intersecting transformed faces", () => {
  const parent = new Group();
  parent.position.set(4, 3, -2); parent.rotation.y = .7;
  const a = new Mesh(new BoxGeometry(1, 1, 1));
  const b = new Mesh(new BoxGeometry(1, 1, 1));
  b.position.x = .6;
  parent.add(a, b);
  expect(intersectMeshSurfaces(meshSurface(a), meshSurface(b))).not.toBeNull();
  b.position.x = 1.2;
  expect(intersectMeshSurfaces(meshSurface(a), meshSurface(b))).toBeNull();
});

it("preserves a hollow ring opening instead of treating its bounding box as solid", () => {
  const ring = new Mesh(new TorusGeometry(.5, .1, 8, 16));
  ring.rotation.x = Math.PI / 2;
  const bucket = new Mesh(new BoxGeometry(.15, .15, .15));
  const rim = meshSurface(ring), emptyCenter = meshSurface(bucket);
  expect(rim.bounds.intersectsBox(emptyCenter.bounds)).toBe(true);
  expect(intersectMeshSurfaces(rim, emptyCenter)).toBeNull();
  bucket.position.x = .5;
  expect(intersectMeshSurfaces(rim, meshSurface(bucket))).not.toBeNull();
});

it("honors visibility of earlier stock and all ancestor groups", () => {
  const parent = new Group(), stock = new Mesh(new BoxGeometry());
  parent.add(stock);
  expect(objectIsVisible(stock)).toBe(true);
  parent.visible = false;
  expect(objectIsVisible(stock)).toBe(false);
  parent.visible = true; stock.visible = false;
  expect(objectIsVisible(stock)).toBe(false);
});
