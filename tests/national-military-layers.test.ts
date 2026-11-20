import { attachArmourLayer } from "@workers/game-three-armour-layers";
import { loadLayeredArmour } from "@workers/game-three-layered-armour";
import { SharedWorkerModelCache } from "@workers/game-three-model-cache";
import type { ThreeWorkerPack } from "@workers/game-three-worker";
import { Bone, BoxGeometry, Group, MeshStandardMaterial, Skeleton, SkinnedMesh } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { expect, it, vi } from "vitest";

const rigged = () => {
  const root = new Group(), bones = Array.from({ length: 52 }, (_, index) => {
    const bone = new Bone(); bone.name = `joint-${index}`; return bone;
  });
  root.add(bones[0]!);
  for (let at = 1; at < bones.length; at++) bones[0]!.add(bones[at]!);
  const mesh = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
  mesh.name = "national_armour_layer_lod0";
  root.add(mesh); root.updateMatrixWorld(true); mesh.bind(new Skeleton(bones));
  return { root, mesh, bones };
};

it("shares a base request and geometry while each actor owns bones and tintable materials", async () => {
  const source = rigged(), freeGeometry = vi.spyOn(source.mesh.geometry, "dispose");
  const load = vi.fn(async () => ({ scene: source.root } as GLTF));
  const cache = new SharedWorkerModelCache(load);
  const [first, second] = await Promise.all([cache.acquire("base.glb"), cache.acquire("base.glb")]);
  const a = first.scene.getObjectByName(source.mesh.name) as SkinnedMesh;
  const b = second.scene.getObjectByName(source.mesh.name) as SkinnedMesh;
  expect(load).toHaveBeenCalledTimes(1);
  expect(a.geometry).toBe(b.geometry);
  expect(a.skeleton.bones[0]).not.toBe(b.skeleton.bones[0]);
  expect(a.material).not.toBe(b.material);
  (a.material as MeshStandardMaterial).color.set("red");
  expect((b.material as MeshStandardMaterial).color.getHexString()).toBe("ffffff");
  a.skeleton.bones[0]!.position.x = 2;
  expect(b.skeleton.bones[0]!.position.x).toBe(0);
  first.release(); first.release(); await Promise.resolve();
  expect(freeGeometry).not.toHaveBeenCalled();
  second.release(); await Promise.resolve();
  expect(freeGeometry).toHaveBeenCalledTimes(1);
});

it("evicts a failed base request so a later soldier can retry", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ scene: rigged().root } as GLTF);
  const cache = new SharedWorkerModelCache(load);
  await expect(cache.acquire("base.glb")).rejects.toThrow("network");
  const retried = await cache.acquire("base.glb");
  expect(load).toHaveBeenCalledTimes(2); retried.release();
});

it("binds opaque and team clothing to the exact same animated actor skeleton", () => {
  const actor = rigged(), outfit = rigged();
  const team = outfit.mesh.clone(); team.name = "national_team_binding_lod0";
  outfit.root.add(team);
  const oldSkeleton = outfit.mesh.skeleton, disposeSkeleton = vi.spyOn(oldSkeleton, "dispose");
  const detach = attachArmourLayer(actor.root, outfit.root);
  expect(outfit.mesh.skeleton).toBe(actor.mesh.skeleton);
  expect(team.skeleton).toBe(actor.mesh.skeleton);
  expect(actor.root.children).toContain(outfit.mesh);
  expect(disposeSkeleton).toHaveBeenCalledTimes(1);
  expect(outfit.root.children).toHaveLength(0);
  actor.bones[3]!.rotation.x = .5;
  expect(team.skeleton.bones[3]!.rotation.x).toBe(.5);
  detach(); expect(outfit.mesh.parent).toBeNull(); expect(team.parent).toBeNull();
});

it.each(["order", "inverse", "bind"])("rejects incompatible %s before attaching any clothing", mismatch => {
  const actor = rigged(), outfit = rigged();
  if (mismatch === "order") outfit.mesh.skeleton.bones.reverse();
  if (mismatch === "inverse") outfit.mesh.skeleton.boneInverses[3]!.elements[12] = .01;
  if (mismatch === "bind") outfit.mesh.bindMatrix.elements[12] = .01;
  expect(() => attachArmourLayer(actor.root, outfit.root)).toThrow("skin/bind frame mismatch");
  expect(outfit.mesh.parent).toBe(outfit.root);
  expect(actor.root.children).not.toContain(outfit.mesh);
});

it("loads a lean common base and rank layer, applies faction tint and releases once", async () => {
  const actor = rigged(), outfit = rigged(), release = vi.fn(), dispose = vi.fn(), setTeamColor = vi.fn();
  const workers = {
    load: vi.fn(async () => ({ root: actor.root, entry: { tunicTint: "#ffaa22" }, dispose, setTeamColor })),
    loadSharedModel: vi.fn(async () => ({ scene: outfit.root, release }))
  };
  const loaded = await loadLayeredArmour({ body: {
    id: "chinese-male-1", models: { recruit: "base.glb", soldier: "base.glb", centurion: "base.glb" },
    modelsMinimal: { soldier: "base-minimal.glb" }, files: {}
  }, layer: "soldier-minimal.glb", minimal: true, nation: "chinese", rank: "soldier", rigid: [],
  url: path => `https://game.test/${path}`, variant: "chinese-male-1", workers: workers as unknown as ThreeWorkerPack });
  expect(workers.load).toHaveBeenCalledWith("chinese", "chinese-male-1", "https://game.test/base-minimal.glb", true);
  expect(workers.loadSharedModel).toHaveBeenCalledWith("https://game.test/soldier-minimal.glb", "chinese-male-1");
  expect(setTeamColor).toHaveBeenCalledWith("#ffaa22");
  expect(outfit.mesh.skeleton).toBe(actor.mesh.skeleton);
  loaded.dispose(); loaded.dispose();
  expect(release).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1);
  expect(outfit.mesh.parent).toBeNull();
});

it("releases the base and layer if skin validation fails before a soldier is returned", async () => {
  const actor = rigged(), outfit = rigged(), release = vi.fn(), dispose = vi.fn();
  outfit.bones[3]!.name = "wrong-joint";
  const freeLayerSkeleton = vi.spyOn(outfit.mesh.skeleton, "dispose");
  const workers = {
    load: vi.fn(async () => ({ root: actor.root, dispose })),
    loadSharedModel: vi.fn(async () => ({ scene: outfit.root, release }))
  };
  await expect(loadLayeredArmour({ body: {
    id: "maya-male-1", models: { recruit: "base.glb", soldier: "base.glb", centurion: "base.glb" }, files: {}
  }, layer: "soldier.glb", minimal: false, nation: "maya", rank: "soldier", rigid: [],
  url: path => path, variant: "maya-male-1", workers: workers as unknown as ThreeWorkerPack }))
    .rejects.toThrow("skin/bind frame mismatch");
  expect(dispose).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  expect(freeLayerSkeleton).toHaveBeenCalledOnce();
});
