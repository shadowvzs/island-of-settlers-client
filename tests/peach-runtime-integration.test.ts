import { InstancedMesh, Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster, Texture, TextureLoader, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { getRoadDecorationItem } from "../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantModel } from "../../island-of-settlers-shared/src/road-plant-models";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { loadPeachProductionResources } from "../src/renderers/three/plants/peach-production-resources";
import { createPeachProductionTemplates } from "../src/renderers/three/plants/peach-production-templates";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import { huntingWorld } from "./helpers/hunting-world";

const peachId = (variant: 0 | 1 | 2) => `roadDecoration:plant-pink-peach-standalone-ground-${variant}:native` as const;
const fakeAtlasOwner = async (detailed: boolean) => {
  const loader = new TextureLoader();
  vi.spyOn(loader, "loadAsync").mockImplementation(async () => new Texture<HTMLImageElement>());
  return loadPeachProductionResources({ far: ["a", "b", "c"], crowns: ["d", "e", "f"] }, detailed, undefined, loader);
};

it.each([true, false])("shares atomic peach resources across flat near/far models and rejects transparent padding as physics; High=%s", async detailed => {
  const resources = await fakeAtlasOwner(detailed), disposed = vi.spyOn(resources, "dispose");
  const load = vi.fn(async () => resources), owner = createPeachProductionTemplates(detailed, load);
  const models = await Promise.all([0, 1, 2].flatMap(variant =>
    ["near", "far", "overview"].map(tier => owner.create(variant, tier as "near" | "far" | "overview"))));
  expect(load).toHaveBeenCalledTimes(1); expect(owner.statistics().users).toBe(9);
  for (const [index, model] of models.entries()) {
    expect(model).toBeDefined();
    const variant = Math.floor(index / 3), tier = index % 3;
    const nearTriangles = detailed ? 22124 : 5912;
    expect(model!.triangles).toBe(tier ? 2 : nearTriangles);
    expect(model!.root.children).toHaveLength(tier ? 1 : 4);
    const item = getRoadDecorationItem(peachId(variant as 0 | 1 | 2))!;
    expect(ornamentalPlantModel(item.plant!)).toBe("flowering-peach");
    const bounds = roadDecorationClearance(getRoadDecoration(item.decoration)!);
    expect(bounds.volumes.some(box => box.min[0] <= 2.5 && box.max[0] >= 2.5 &&
      box.min[1] <= .1 && box.max[1] >= .1 && box.min[2] <= 0 && box.max[2] >= 0)).toBe(false);
    if (!tier) for (const mesh of model!.root.children as Mesh[]) {
      if (mesh.name === "peach-original-crown-masses") continue;
      const positions = mesh.geometry.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = [positions.getX(vertex), Math.max(0, positions.getY(vertex)), positions.getZ(vertex)];
        expect(bounds.volumes.some(box => point.every((value, axis) =>
          value >= box.min[axis]! - 1e-5 && value <= box.max[axis]! + 1e-5))).toBe(true);
      }
    }
  }
  models.slice(0, -1).forEach(model => { model!.dispose(); model!.dispose(); });
  expect(disposed).not.toHaveBeenCalled(); models.at(-1)!.dispose();
  expect(disposed).toHaveBeenCalledTimes(1); expect(owner.statistics().users).toBe(0);
});

it("releases a stale in-flight owner atomically and retries a failed atlas load", async () => {
  const resources = await fakeAtlasOwner(false), disposed = vi.spyOn(resources, "dispose");
  let resolve!: (owner: typeof resources) => void;
  const pending = new Promise<typeof resources>(done => { resolve = done; });
  const load = vi.fn().mockRejectedValueOnce(new Error("missing image")).mockReturnValueOnce(pending);
  const owner = createPeachProductionTemplates(false, load);
  await expect(owner.create(0, "far")).rejects.toThrow("missing image");
  const obsolete = owner.create(0, "far", () => false); resolve(resources);
  expect(await obsolete).toBeUndefined(); expect(disposed).toHaveBeenCalledTimes(1);
  expect(owner.statistics()).toEqual({ users: 0, ready: false, pending: false });
});

it("batches a thousand real peach placements cheaply, preserves shader hooks in ghost/hover, and rotates/moves the same saved UID", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const resources = await fakeAtlasOwner(false), templates = createPeachProductionTemplates(false, async () => resources);
  const owner = createThreeRoadDecorations(world, false, () => { throw new Error("No national material"); },
    async (_id, key, active, tier) => {
      const model = await templates.create(0, tier ?? "near", active);
      return model && { ...model, key };
    });
  const context = () => ({ nation: "roman" as const, roads: [], heightAt: () => 0,
    isOwned: () => true, isFree: () => true });
  const state = createRoadDecorationState(context);
  expect(state.place({ item: peachId(0), position: { x: 20, z: 20 }, yaw: 0 }, () => true).ok).toBe(true);
  expect(state.rotate(1).ok).toBe(true);
  expect(state.move(1, { x: 30, z: 30 }, Math.PI / 2).ok).toBe(true);
  const saved = state.save(); state.load(saved); expect(state.save()).toEqual(saved);
  const first = state.frames()[0]!;
  const frames = Array.from({ length: 1000 }, (_, uid) => ({ ...first, uid: uid + 1,
    position: [32 + uid % 32 * 8, 0, 32 + Math.floor(uid / 32) * 8] as [number, number, number],
    volumes: first.volumes.map(box => ({ min: [box.min[0] + 2 + uid % 32 * 8, box.min[1], box.min[2] + 2 + Math.floor(uid / 32) * 8] as [number, number, number],
      max: [box.max[0] + 2 + uid % 32 * 8, box.max[1], box.max[2] + 2 + Math.floor(uid / 32) * 8] as [number, number, number] })) }));
  const camera = new OrthographicCamera(-300, 300, 250, -250, .1, 2000);
  camera.position.set(500, 400, 500); camera.lookAt(150, 0, 150); camera.updateProjectionMatrix();
  try {
    owner.update(frames, camera); await owner.ready(); owner.root.updateMatrixWorld(true);
    expect(owner.statistics()).toMatchObject({ instances: 1000, batches: 1, errors: 0 });
    const mesh = owner.root.children[0] as InstancedMesh;
    expect(mesh.count).toBe(1000); expect(mesh.customDepthMaterial).toBeDefined();
    expect(mesh.material).toBe(resources.materialsForVariant(0).impostor);
    const target = frames[777]!;
    expect(owner.pick(new Raycaster(new Vector3(target.position[0], 8, target.position[2]), new Vector3(0, -1, 0)))?.uid).toBe(target.uid);
    expect(owner.pick(new Raycaster(new Vector3(target.position[0] + 2.5, .1, target.position[2] - 1),
      new Vector3(0, 0, 1), 0, 2))).toBeUndefined();
    expect(owner.setHover(target.uid)).toBe(true); owner.setHover(null);
    owner.updateGhost({ item: peachId(0), position: [5, 0, 5], yaw: .7, valid: true }); await owner.ready();
    // Preview meshes preserve the original shader even though their tint is private.
    const preview = owner.ghostRoot.children.find(child => (child as Mesh).material instanceof MeshBasicMaterial) as Mesh;
    expect(preview).toBeDefined();
    expect((preview.material as MeshBasicMaterial).onBeforeCompile).toBe(resources.materialsForVariant(0).crowns!.onBeforeCompile);
  } finally { owner.dispose(); }
});
