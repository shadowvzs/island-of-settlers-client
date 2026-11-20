import { measureNationalHeadFit } from "@workers/national-headwear-fit";
import { createNationalWorkerHeadwear } from "@workers/national-worker-headwear";
import { Bone, BoxGeometry, Float32BufferAttribute, Group, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from "three";
import { expect, it } from "vitest";

import { nationalHeadwearFor } from "../src/renderers/three/worker-national-headwear";
import { meshTriangleCount, visibleMeshBounds } from "./helpers/visible-mesh-bounds";

it("fits the hat band to the skull while keeping the topknot in its clearance envelope", () => {
  const root = new Group(), head = new Bone(); head.name = "Head"; root.add(head);
  const add = (height: number, y: number, name: string) => {
    const geometry = new BoxGeometry(.10, height, .10).translate(0, y, 0);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(
      Array.from({ length: count * 4 }, (_, at) => at % 4 === 0 ? 1 : 0), 4));
    const material = new MeshStandardMaterial(); material.name = name;
    const mesh = new SkinnedMesh(geometry, material); root.add(mesh);
    mesh.bind(new Skeleton([head]));
  };
  add(.12, .10, "worker_body");
  const skull = measureNationalHeadFit(root, head)!;
  add(.08, .23, "national_combed_hair");
  // New geometry cache key forces an independent fit for the second body state.
  (root.children[1] as SkinnedMesh).geometry = (root.children[1] as SkinnedMesh).geometry.clone();
  const withBun = measureNationalHeadFit(root, head)!;
  expect(withBun.centre).toEqual(skull.centre);
  expect(withBun.top).toBe(skull.top);
  expect(Math.max(...withBun.points.map(point => point[1]))).toBeGreaterThan(withBun.top + .05);
});

it("adds deterministic hats only to a minority of the correct nation's civilians", () => {
  for (const nation of ["roman", "viking", "japanese", "nubian", "persian", "maya"] as const)
    for (let actorId = 0; actorId < 32; actorId++) expect(nationalHeadwearFor({ nation, actorId })).toBeUndefined();
  const chinese = Array.from({ length: 32 }, (_, actorId) => nationalHeadwearFor({ nation: "roman", propNation: "chinese", actorId }));
  expect(chinese.filter(Boolean)).toHaveLength(8);
  expect(chinese.filter(style => style === "chinese-conical")).toHaveLength(4);
  expect(chinese.filter(style => style === "chinese-folded")).toHaveLength(4);
  const indigenous = Array.from({ length: 32 }, (_, actorId) => nationalHeadwearFor({ nation: "roman", propNation: "indigenous", actorId }));
  expect(indigenous.filter(Boolean)).toHaveLength(8);
  expect(nationalHeadwearFor({ nation: "chinese", actorId: 8, armourRank: "soldier" })).toBeUndefined();
  expect(nationalHeadwearFor({ nation: "chinese", actorId: 8, combat: {} as any })).toBeUndefined();
});

it.each([true, false])("keeps all reusable hat meshes finite and lean (High=%s)", detailed => {
  for (const kind of ["chinese-conical", "chinese-folded", "indigenous-headband"] as const) {
    const model = createNationalWorkerHeadwear(kind, detailed);
    expect(model.root.children.length).toBeLessThanOrEqual(3);
    expect(meshTriangleCount(model.root)).toBeLessThan(detailed ? 1800 : 550);
    const bounds = visibleMeshBounds(model.root);
    expect(Number.isFinite(bounds.min.y + bounds.max.y)).toBe(true);
    if (kind === "indigenous-headband") expect(bounds.max.y).toBeGreaterThan(1.5);
    model.dispose();
  }
});
