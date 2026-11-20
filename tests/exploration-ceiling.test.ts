import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SkinnedMesh } from "three";
import { expect, it } from "vitest";

import { createExplorationCeilingQuery } from "../src/renderers/three/exploration/exploration-ceiling";

it("samples the real underside of a nearby beam and ignores stock and bodies", () => {
  const query = createExplorationCeilingQuery(), root = new Group();
  const geometry = new BoxGeometry(2, .2, 2), material = new MeshBasicMaterial();
  const beam = new Mesh(geometry, material); beam.position.y = 1.4; root.add(beam);
  const stock = new Mesh(geometry, material); stock.position.y = .7; stock.userData.stock = { ware: "stone" }; root.add(stock);
  const body = new SkinnedMesh(geometry, material); body.position.y = .6; root.add(body);
  query.sync("beam", root);
  expect(query.stats().rays).toBe(0);
  expect(query.sample(0, 0, 0, .16, 2)).toBeCloseTo(1.3);
  beam.visible = false;
  expect(query.sample(0, 0, 0, .16, 2)).toBe(Infinity);
  query.remove("beam"); expect(query.sample(0, 0, 0, .16, 2)).toBe(Infinity);
  geometry.dispose(); material.dispose();
});

it("indexes distant structures without raycasting them and updates moved/replaced models", () => {
  const query = createExplorationCeilingQuery(), geometry = new BoxGeometry(2, .2, 2), material = new MeshBasicMaterial();
  for (let id = 0; id < 400; id++) {
    const root = new Group(); root.add(new Mesh(geometry, material)); root.position.set(100 + id * 10, 1.4, 100);
    query.sync(String(id), root);
  }
  const near = new Group(); near.add(new Mesh(geometry, material)); near.position.y = 1.4;
  query.sync("near", near);
  expect(query.sample(0, 0, 0, .16, 2)).toBeCloseTo(1.3);
  expect(query.stats()).toMatchObject({ candidates: 1, rays: 5 });
  near.position.x = 20; query.sync("near", near);
  expect(query.sample(0, 0, 0, .16, 2)).toBe(Infinity);
  query.clear(); expect(query.stats().structures).toBe(0);
  geometry.dispose(); material.dispose();
});
