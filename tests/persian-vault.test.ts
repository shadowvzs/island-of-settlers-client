import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { persianBarrelHeight, persianDomeMeshHeight } from "../src/render-common/buildings/persian-vault-profile";
import {
  createPersianBarrel, createPersianBarrelEnd, createPersianDome, createPersianTransition
} from "../src/renderers/three/buildings/persian-vault";

it.each([true, false])("shares exact dome contacts, a hollow intrados and an open oculus (%s)", detailed => {
  const geometry = createPersianDome(detailed), material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const down = (x: number, z: number) => new Raycaster(new Vector3(x, 2, z), new Vector3(0, -1, 0))
    .intersectObject(mesh);
  expect(down(0, 0)).toHaveLength(0);
  expect(persianDomeMeshHeight(0, 0, detailed)).toBeNull();
  const lip = down(.043, 0);
  expect(lip[0]!.point.y).toBeCloseTo(persianDomeMeshHeight(.043, 0, detailed)!, 5);
  for (const [x, z] of [[.07, .06], [.19, .23], [-.24, .11], [.48, 0]]) {
    const hits = down(x!, z!);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]!.point.y).toBeCloseTo(persianDomeMeshHeight(x!, z!, detailed)!, 5);
    expect(hits.at(-1)!.point.y).toBeLessThan(hits[0]!.point.y - .015);
  }
  expect(down(.51, 0)).toHaveLength(0);
  expect(geometry.getIndex()!.count / 3).toBeLessThanOrEqual(detailed ? 2400 : 500);
  geometry.dispose(); material.dispose();
});

it("closes square chamber corners with actual sloping, outward-facing squinch masonry", () => {
  const geometry = createPersianTransition(), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const down = (x: number, z: number) => new Raycaster(new Vector3(x, 2, z), new Vector3(0, -1, 0))
    .intersectObject(mesh);
  const up = (x: number, z: number) => new Raycaster(new Vector3(x, -2, z), new Vector3(0, 1, 0))
    .intersectObject(mesh);
  expect(down(.46, .46)[0]!.point.y).toBeCloseTo(.5);
  expect(up(.46, .46)[0]!.point.y).toBeCloseTo(-.5);
  expect(up(.35, .35)[0]!.point.y).toBeGreaterThan(-.5);
  expect(up(0, 0)).toHaveLength(0);
  geometry.dispose(); material.dispose();
});

it.each([true, false])("fills the elliptical vault end without projecting outside the barrel (%s)", detailed => {
  const geometry = createPersianBarrelEnd(detailed), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const front = (x: number, y: number) => new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1))
    .intersectObject(mesh);
  expect(front(0, .3).length).toBeGreaterThan(0);
  expect(front(0, .51)).toHaveLength(0);
  expect(front(.49, .4)).toHaveLength(0);
  geometry.dispose(); material.dispose();
});

it.each([true, false])("has a deep true elliptical barrel opening and thick crown (%s)", detailed => {
  const geometry = createPersianBarrel(detailed), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const front = (x: number, y: number) => new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1))
    .intersectObject(mesh);
  expect(front(0, 0)).toHaveLength(0);
  expect(front(0, .39).length).toBeGreaterThan(0);
  expect(front(.46, -.4).length).toBeGreaterThan(0);
  expect(geometry.boundingBox!.min.z).toBe(-.5);
  expect(geometry.boundingBox!.max.z).toBe(.5);
  for (const x of [-.41, -.16, .09, .33]) {
    const hits = new Raycaster(new Vector3(x, 2, .13), new Vector3(0, -1, 0)).intersectObject(mesh);
    expect(hits[0]!.point.y).toBeCloseTo(persianBarrelHeight(x, detailed)!, 5);
  }
  geometry.dispose(); material.dispose();
});
