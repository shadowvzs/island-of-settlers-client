import { Group, InstancedMesh, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getRoadDecorationItem } from "../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_NATIVE_ACCEPTED } from "../../island-of-settlers-shared/src/road-plant-completion";
import { ornamentalPlantModel } from "../../island-of-settlers-shared/src/road-plant-models";
import { computeEnvironment, TIME_PRESETS } from "../src/render-common/environment";
import { ornamentalOverviewLight } from "../src/render-common/plants/ornamental-overview-light";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { createOrnamentalPlantLod } from "../src/renderers/three/plants/ornamental-plant-lod";
import { createOrnamentalPlantModel, createOrnamentalPlantModels } from "../src/renderers/three/plants/ornamental-plant-model";
import { createDecorationAssetLoader } from "../src/renderers/three/road-decoration-asset-loader";
import { createRoadDecorationTemplates } from "../src/renderers/three/road-decoration-templates";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { roadDecorationSaveProblem } from "../src/shared/settlement/road-decoration-save";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

const item = (species: string, form: string, pot: string, variant: number) =>
  getRoadDecorationItem(`roadDecoration:plant-${species}-${form}-${pot}-${variant}:native`)!;

const indexBounds = (boxes: ReturnType<typeof roadDecorationClearance>["volumes"]) => {
  const buckets = new Map<string, typeof boxes[number][]>();
  const cell = (value: number) => Math.floor(value * 4);
  for (const box of boxes) {
    for (let x = cell(box.min[0] - 1e-5); x <= cell(box.max[0] + 1e-5); x++)
      for (let z = cell(box.min[2] - 1e-5); z <= cell(box.max[2] + 1e-5); z++) {
        const key = `${x}:${z}`, bucket = buckets.get(key) ?? [];
        bucket.push(box); buckets.set(key, bucket);
      }
  }
  return (point: number[]) => (buckets.get(`${cell(point[0]!)}:${cell(point[2]!)}`) ?? []).some(box =>
    point.every((value, axis) => value >= box.min[axis]! - 1e-5 && value <= box.max[axis]! + 1e-5));
};

it("dispatches only botanically matching accepted forms, preserving legacy IDs and selective availability", () => {
  const elm = item("bonsai-maple", "roadside", "pot", 0);
  expect(elm.name).toBe("Elm bonsai");
  expect(elm.decoration).toContain("bonsai-maple");
  expect(ornamentalPlantModel(elm.plant!)).toBe("bonsai-elm");
  expect(ornamentalPlantModel(item("red-maple", "standalone", "ground", 0).plant!)).toBe("maple-tree");
  expect(ornamentalPlantModel(item("red-maple", "roadside", "ground", 0).plant!)).toBe("catalog-flowering");
  expect(ornamentalPlantModel(item("round-myrtle", "roadside", "ground", 1).plant!)).toBe("roadside-shrub");
  expect(ornamentalPlantModel(item("round-myrtle", "roadside", "ground", 0).plant!)).toBe("catalog-shrub");
  expect(ornamentalPlantModel(item("pink-peach", "standalone", "ground", 0).plant!)).toBe("flowering-peach");
  expect(elm.shopAvailable).toBe(true);
  expect(item("pink-peach", "standalone", "ground", 0).shopAvailable).toBe(true);
  expect(item("pink-peach", "roadside", "ground", 0).shopAvailable).toBe(PLANT_COMPLETION_NATIVE_ACCEPTED);
  expect(getRoadDecorationItem("roadDecoration:plant-pink-peach-roadside-pot-0:native")).toBeUndefined();
});

it("gives allthree maple forms orthogonal yellow/orange/red SKUs sharing real geometry/maps and physical bounds", () => {
  for (const detailed of [true, false]) for (const tier of ["near", "far"] as const) {
    const owner = createOrnamentalPlantModels(detailed), owned = [], released: (() => number)[] = [];
    try {
      for (const variant of [0, 1, 2]) {
        const red = item("red-maple", "standalone", "ground", variant);
        const yellow = item("red-maple-yellow", "standalone", "ground", variant);
        const orange = item("red-maple-orange", "standalone", "ground", variant);
        expect(yellow.plant?.species).toBe("red-maple"); expect(yellow.plant?.palette).toBe("yellow");
        expect(orange.plant?.species).toBe("red-maple"); expect(orange.plant?.palette).toBe("orange");
        expect(roadDecorationClearance(getRoadDecoration(red.decoration)!))
          .toBe(roadDecorationClearance(getRoadDecoration(yellow.decoration)!));
        const models = [red, yellow, orange].map(sku => owner.create(sku.plant!, tier)); owned.push(...models);
        const leaves = models.map(model => model.root.getObjectByName("maple-leaves") as Mesh);
        const bark = models.map(model => model.root.getObjectByName("maple-bark") as Mesh);
        let count = 0; leaves[0]!.geometry.addEventListener("dispose", () => { count++; }); released.push(() => count);
        expect(new Set(leaves.map(mesh => mesh.geometry)).size).toBe(1);
        expect(new Set(bark.map(mesh => mesh.geometry)).size).toBe(1);
        const materials = leaves.map(mesh => mesh.material as import("three").MeshStandardMaterial);
        expect(new Set(materials.map(material => material.map)).size).toBe(1);
        expect(new Set(materials.map(material => material.color.getHex())).size).toBe(3);
        expect(models.every(model => model.triangles <= (detailed ? 24000 : 8075))).toBe(true);
        models[0]!.dispose(); expect(count).toBe(0);
        expect(leaves[1]!.geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    } finally { owned.forEach(model => model.dispose()); }
    expect(released.map(count => count())).toEqual([1, 1, 1]);
  }
});

it("contains actual High and Minimal geometry in camera-independent canonical clearance", () => {
  const specimens = [
    ...[0, 1, 2].map(variant => item("bonsai-maple", "roadside", "pot", variant)),
    ...[0, 1, 2].map(variant => item("red-maple", "standalone", "ground", variant)),
    item("round-boxwood", "roadside", "pot", 0),
    item("round-myrtle", "roadside", "ground", 1),
    item("myrtle", "roadside", "pot", 2)
  ];
  const indexed = specimens.map(sku => ({ sku,
    contains: indexBounds(roadDecorationClearance(getRoadDecoration(sku.decoration)!).volumes) }));
  for (const detailed of [true, false]) {
    const owner = createOrnamentalPlantModels(detailed), owned = [];
    try {
      for (const { contains, sku } of indexed) for (const tier of ["near", "far"] as const) {
        const model = owner.create(sku.plant!, tier); owned.push(model);
        expect(model.triangles).toBeGreaterThan(0);
        if (tier === "far") expect(model.triangles).toBeLessThan(2400);
        for (const child of model.root.children) {
          if (!(child instanceof Mesh)) throw new Error("Template requires flat instanced surfaces");
          const position = child.geometry.getAttribute("position");
          for (let vertex = 0; vertex < position.count; vertex++) {
            const point = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
            if (!contains(point)) throw new Error(`Unreserved ${sku.decoration}/${detailed}/${child.name}: ${point.join(",")}`);
          }
        }
      }
    } finally { owned.forEach(model => { model.dispose(); model.dispose(); }); }
    expect(owned.every(model => model.root.children.length === 0)).toBe(true);
  }
});

it("loads real elm without borrowing national materials and cancels stale imports before allocation", async () => {
  const load = createDecorationAssetLoader(() => { throw new Error("Unexpected national material acquisition"); }, false);
  const id = "roadDecoration:plant-bonsai-maple-roadside-pot-0:native";
  expect(await load(id, "cancelled", () => false)).toBeUndefined();
  const model = await load(id, "elm", () => true);
  expect(model?.key).toBe("elm");
  expect(model?.root.name).toContain("bonsai-elm");
  model?.dispose(); model?.dispose();
});

it("routes additive hanging portals through flat canonical templates after accepted acquisition release", async () => {
  const materials = createPlainBuildingMaterials(), nations: string[] = [];
  const load = createDecorationAssetLoader(nation => { nations.push(nation); return materials; }, false);
  try {
    for (const content of ["japanese-hanging-lantern-torii", "chinese-hanging-lantern-pailou"]) {
      const id = `roadDecoration:${content}:native`;
      expect(getRoadDecorationItem(id)?.shopAvailable).toBe(true);
      const model = await load(id, id, () => true);
      try {
        expect(model?.root.children.length).toBeGreaterThan(0);
        expect(model?.root.children.every(part => part instanceof Mesh)).toBe(true);
      } finally { model?.dispose(); }
    }
    expect(nations).toEqual(["japanese", "chinese"]);
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("bounds hero instances and avoids changes within a camera quantization cell", () => {
  for (const detailed of [true, false]) {
    const lod = createOrnamentalPlantLod(detailed);
    const frames = Array.from({ length: 100 }, (_, uid) => ({ uid,
      item: "roadDecoration:plant-red-maple-standalone-ground-0:native" as const,
      position: [uid % 10, 0, Math.floor(uid / 10)] as [number, number, number],
      yaw: uid, volumes: [], supports: [] }));
    expect(lod.update(frames, { position: { x: 1, y: 5, z: 1 } })).toBe(true);
    expect(frames.filter(frame => lod.tierFor(frame.uid) === "near")).toHaveLength(2);
    expect(lod.update(frames, { position: { x: 1.1, y: 5.1, z: 1.1 } })).toBe(false);
    expect(lod.update(frames, { position: { x: 100, y: 100, z: 100 } })).toBe(true);
    expect(frames.every(frame => lod.tierFor(frame.uid) !== "near")).toBe(true);
    lod.dispose();
  }
});

it("uses projected size for the real isometric camera rather than its fixed600-unit eye distance", () => {
  const camera = new OrthographicCamera(-6, 6, 5, -5, .1, 2000);
  camera.position.set(367, 300, 367); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const frames = [{ uid: 1, item: "roadDecoration:plant-bonsai-maple-roadside-pot-0:native" as const,
    position: [0, 0, 0] as [number, number, number], yaw: 0, volumes: [], supports: [] }];
  const lod = createOrnamentalPlantLod(false);
  expect(lod.update(frames, camera, 900)).toBe(true);
  expect(lod.tierFor(1)).toBe("near");
  camera.top = 9; camera.bottom = -9; camera.updateProjectionMatrix();
  expect(lod.update(frames, camera, 900)).toBe(true);
  expect(lod.tierFor(1)).toBe("far");
  camera.top = 50; camera.bottom = -50; camera.updateProjectionMatrix();
  expect(lod.update(frames, camera, 900)).toBe(true);
  expect(lod.tierFor(1)).toBe("overview");
  lod.dispose();
});

it("keeps1000 approved plants inside a dedicated margin at overview and a closer projection", () => {
  const frames = Array.from({ length: 1000 }, (_, uid) => ({ uid,
    item: "roadDecoration:plant-round-boxwood-roadside-ground-0:native" as const,
    position: [uid % 32, 0, Math.floor(uid / 32)] as [number, number, number], yaw: 0, volumes: [], supports: [] }));
  const camera = new OrthographicCamera(-50, 50, 40, -40, .1, 2000);
  camera.position.set(383, 300, 383); camera.lookAt(16, 0, 16); camera.updateProjectionMatrix();
  for (const detailed of [true, false]) {
    const lod = createOrnamentalPlantLod(detailed);
    lod.update(frames, camera);
    expect(frames.every(frame => lod.tierFor(frame.uid) === "overview")).toBe(true);
    const near = createOrnamentalPlantModel(item("round-boxwood", "roadside", "ground", 0).plant!, detailed);
    const far = createOrnamentalPlantModel(item("round-boxwood", "roadside", "ground", 0).plant!, detailed, "far");
    try {
      camera.zoom = 10; camera.updateProjectionMatrix(); lod.update(frames, camera);
      const triangles = frames.reduce((sum, frame) => {
        const tier = lod.tierFor(frame.uid);
        if (tier === "near") return sum + near.triangles;
        if (tier === "far") return sum + far.triangles;
        return sum + 2;
      }, 0);
      expect(triangles).toBeLessThanOrEqual(detailed ? 100000 : 60000);
    } finally { near.dispose(); far.dispose(); lod.dispose(); camera.zoom = 1; camera.updateProjectionMatrix(); }
  }
});

it("batches1000 tiny overview instances globally, picks their canonical physical UID and darkens at night", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const owner = createThreeRoadDecorations(world, false, () => { throw new Error("Unexpected national maps"); },
    async (_id, key, _active, tier) => {
      expect(tier).toBe("overview");
      const root = new Group(), geometry = new PlaneGeometry(1, 1), material = new MeshBasicMaterial();
      const mesh = new Mesh(geometry, material); mesh.name = "canonical-plant-overview"; root.add(mesh);
      return { root, key, triangles: 2, dispose: () => { root.clear(); geometry.dispose(); material.dispose(); } };
    });
  const frames = Array.from({ length: 1000 }, (_, uid) => {
    const x = 2 + uid % 32, z = 2 + Math.floor(uid / 32);
    return { uid, item: "roadDecoration:plant-round-boxwood-roadside-ground-0:native" as const,
      position: [x, 0, z] as [number, number, number], yaw: uid,
      volumes: [{ min: [x - .3, 0, z - .3] as [number, number, number],
        max: [x + .3, .8, z + .3] as [number, number, number] }], supports: [] };
  });
  const camera = new OrthographicCamera(-60, 60, 50, -50, .1, 2000);
  camera.position.set(383, 300, 383); camera.lookAt(16, 0, 16); camera.updateProjectionMatrix();
  try {
    owner.update(frames, camera); await owner.ready();
    expect(owner.statistics()).toMatchObject({ batches: 1, instances: 1000, errors: 0 });
    const mesh = owner.root.children[0] as InstancedMesh;
    expect(mesh.count).toBe(1000); expect(mesh.castShadow).toBe(false);
    const frame = frames[777]!;
    expect(owner.pick(new Raycaster(new Vector3(frame.position[0], 4, frame.position[2]), new Vector3(0, -1, 0)))?.uid)
      .toBe(777);
    expect(owner.setHover(777)).toBe(true); owner.setHover(null);
    const daylight = (mesh.material as MeshBasicMaterial).color.r;
    owner.updateEnvironment(computeEnvironment({ azimuthX: 0, azimuthZ: 1, elevation: .7 }, TIME_PRESETS.night, 0));
    expect((mesh.material as MeshBasicMaterial).color.r).toBeLessThan(daylight * .4);
  } finally { owner.dispose(); }
});

it("normalizes canonical daytime icon tint and retains the scene's cool low night light", () => {
  const sun = { azimuthX: 0, azimuthZ: 1, elevation: .7 };
  expect(ornamentalOverviewLight(computeEnvironment(sun, TIME_PRESETS.day, 0))).toEqual([1, 1, 1]);
  const night = ornamentalOverviewLight(computeEnvironment(sun, TIME_PRESETS.night, 0));
  expect(night[0]).toBeLessThan(.4); expect(night[2]).toBeGreaterThan(night[0]);
});

it("switches actual instanced templates with isometric zoom while retaining UID picking, ghost and stable uploads", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const owner = createThreeRoadDecorations(world, false, () => { throw new Error("Unexpected national materials"); });
  const camera = new OrthographicCamera(-6, 6, 5, -5, .1, 2000);
  camera.position.set(372, 302, 372); camera.lookAt(5, 2, 5); camera.updateProjectionMatrix();
  const frames = [{ uid: 7, item: "roadDecoration:plant-bonsai-maple-roadside-pot-0:native" as const,
    position: [5, 2, 5] as [number, number, number], yaw: Math.PI / 4, volumes: [], supports: [] }];
  try {
    owner.update(frames, camera); await owner.ready();
    expect(owner.root.children.some(mesh => mesh.name.includes(":far/"))).toBe(false);
    expect(owner.setHover(7)).toBe(true);
    camera.top = 9; camera.bottom = -9; camera.updateProjectionMatrix();
    owner.update(frames, camera); await owner.ready();
    const batches = owner.root.children.filter((mesh): mesh is InstancedMesh => mesh instanceof InstancedMesh);
    expect(batches).toHaveLength(4);
    expect(batches.every(mesh => mesh.name.includes(":far/"))).toBe(true);
    const versions = batches.map(mesh => mesh.instanceMatrix.version);
    for (let index = 0; index < 60; index++) owner.update(frames, camera);
    expect(batches.map(mesh => mesh.instanceMatrix.version)).toEqual(versions);
    owner.root.updateMatrixWorld(true);
    expect(owner.pick(new Raycaster(new Vector3(5, 4, 5), new Vector3(0, -1, 0)))?.uid).toBe(7);
    expect(owner.setHover(7)).toBe(true);
    owner.updateGhost({ item: frames[0]!.item, position: [8, 2, 5], yaw: Math.PI / 2, valid: true });
    await owner.ready();
    expect(owner.ghostRoot.children).toHaveLength(4);
    owner.updateGhost(null); expect(owner.ghostRoot.children).toHaveLength(0);
  } finally { owner.dispose(); owner.dispose(); }
});

it("keeps near preview and far instances independently owned and frees both tiers", async () => {
  const loader = createDecorationAssetLoader(() => { throw new Error("Unexpected national materials"); }, false);
  const owner = createRoadDecorationTemplates(() => { throw new Error("Unexpected materials"); }, false, loader);
  const id = "roadDecoration:plant-bonsai-maple-roadside-pot-0:native";
  owner.retainLods([{ item: id, tier: "near" }, { item: id, tier: "far" }]);
  await Promise.all([owner.request(id), owner.request(id, false, "far")]);
  expect(owner.get(id).triangles).toBe(4344);
  expect(owner.get(id, "far").triangles).toBe(1584);
  expect(owner.get(id).root).not.toBe(owner.get(id, "far").root);
  const nearLeaves = owner.get(id).root.getObjectByName("foliage") as Mesh;
  const farLeaves = owner.get(id, "far").root.getObjectByName("foliage") as Mesh;
  expect(nearLeaves.material).toBe(farLeaves.material);
  const roots = [owner.get(id).root, owner.get(id, "far").root];
  owner.dispose(); owner.dispose();
  expect(roots.every(root => root.children.length === 0)).toBe(true);
});

it("places, rotates, saves, reloads and returns matching botanical SKUs without granting or losing custody", () => {
  const specimens = [item("bonsai-maple", "roadside", "pot", 2),
    item("red-maple", "standalone", "ground", 1), item("myrtle", "roadside", "pot", 2)];
  for (const sku of specimens) {
    const id = `roadDecoration:${sku.decoration}:native` as const;
    let held = 1;
    const context = () => ({ nation: "roman" as const, roads: [], heightAt: () => 0,
      isOwned: () => true, isFree: () => true });
    const first = createRoadDecorationState(context);
    const order = { item: id, position: { x: 25, z: 25 }, yaw: Math.PI * .75 };
    expect(first.plan(order).ok).toBe(true); expect(held).toBe(1);
    expect(first.place(order, () => { held--; return true; })).toEqual({ ok: true, uid: 1 });
    expect(held).toBe(0);
    const saved = first.save(); expect(roadDecorationSaveProblem(saved)).toBeNull();
    expect(saved.placed[0]).toMatchObject({ item: id, yaw: order.yaw });
    const restored = createRoadDecorationState(context); restored.load(saved);
    expect(restored.save()).toEqual(saved);
    expect(restored.frames()[0]?.yaw).toBe(order.yaw);
    expect(restored.pickUp(1)).toEqual({ ok: true, returned: 1 });
    expect(restored.pickUp(1)).toEqual({ ok: true, returned: 0 });
    const ids = restored.returns().map(row => row.id);
    const receive = (items: Readonly<Record<string, number>>) => { held += items[id] ?? 0; return true; };
    expect(restored.claimReturns(ids, receive)).toEqual({ ok: true, returned: 1 });
    expect(restored.claimReturns(ids, receive)).toEqual({ ok: true, returned: 0 });
    expect(held).toBe(1); expect(restored.frames()).toHaveLength(0);
  }
});
