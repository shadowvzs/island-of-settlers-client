import { Group } from "three";
import { describe, expect, it, vi } from "vitest";

import type { DecorationAssetLoader, RoadDecorationTemplate } from "../src/renderers/three/road-decoration-asset-loader";
import { loadDecorationModule } from "../src/renderers/three/road-decoration-module-loader";
import { createRoadDecorationTemplates } from "../src/renderers/three/road-decoration-templates";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

const pot = "roadDecoration:indigenous-flower-pot:native";
const cherry = "roadDecoration:plant-cherry-blossom-roadside-ground-0:native";
const model = (key: string): RoadDecorationTemplate => ({ key, root: new Group(), triangles: 0, dispose: vi.fn() });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe("map-owned asynchronous decoration assets", () => {
  it("does not acquire materials or model modules for an empty map, and deduplicates concurrent requests", async () => {
    const materialsFor = vi.fn(), load = vi.fn<DecorationAssetLoader>(async (_id, key) => model(key));
    const owner = createRoadDecorationTemplates(materialsFor, false, load);
    expect(load).not.toHaveBeenCalled(); expect(materialsFor).not.toHaveBeenCalled();
    owner.retain([pot]);
    const first = owner.request(pot), second = owner.request(pot);
    expect(first).toBe(second);
    await first; expect(load).toHaveBeenCalledOnce(); expect(owner.get(pot).key).toBe(pot);
    owner.dispose();
  });

  it("drops obsolete pending results and frees results after map disposal without attachment", async () => {
    const pending = deferred<RoadDecorationTemplate>(), asset = model(pot);
    const owner = createRoadDecorationTemplates(vi.fn(), true, () => pending.promise);
    owner.retain([pot]); const request = owner.request(pot);
    owner.retain([]); owner.dispose(); pending.resolve(asset);
    expect(await request).toBeUndefined(); expect(asset.dispose).toHaveBeenCalledOnce();
    expect(owner.statistics()).toEqual({ templates: 0, pending: 0, errors: 0 });
  });

  it("keeps active assets and evicts excess inactive GPU resources in least-recent order", async () => {
    const assets = new Map<string, RoadDecorationTemplate>();
    const owner = createRoadDecorationTemplates(vi.fn(), false, async (_id, key) => {
      const asset = model(key); assets.set(key, asset); return asset;
    }, { idleLimit: 0 });
    owner.retain([pot, cherry]); await Promise.all([owner.request(pot), owner.request(cherry)]);
    owner.retain([cherry]);
    expect(assets.get(pot)!.dispose).toHaveBeenCalledOnce(); expect(owner.peek(pot)).toBeUndefined();
    expect(assets.get(owner.keyFor(cherry))!.dispose).not.toHaveBeenCalled();
    owner.dispose(); expect(assets.get(owner.keyFor(cherry))!.dispose).toHaveBeenCalledOnce();
  });

  it("records failure without unhandled rejection and supports an immediate explicit retry", async () => {
    const load = vi.fn<DecorationAssetLoader>().mockRejectedValueOnce(new Error("network unavailable"))
      .mockImplementation(async (_id, key) => model(key));
    const owner = createRoadDecorationTemplates(vi.fn(), false, load); owner.retain([pot]);
    expect(await owner.request(pot)).toBeUndefined(); expect(owner.statistics().errors).toBe(1);
    expect(await owner.request(pot)).toBeUndefined(); expect(load).toHaveBeenCalledOnce();
    expect(await owner.request(pot, true)).toBeDefined(); expect(load).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("cancels preview-only loads before material acquisition and blocks late old-map attachment", async () => {
    const pending = deferred<RoadDecorationTemplate | undefined>(), activeStates: Array<() => boolean> = [];
    const load: DecorationAssetLoader = (_id, _key, active) => { activeStates.push(active); return pending.promise; };
    const materials = createPlainBuildingMaterials(), world = huntingWorld();
    const owner = createThreeRoadDecorations(world, false, () => materials, load);
    owner.updateGhost({ item: pot, position: [3, 2, 3], yaw: 0, valid: true });
    await Promise.resolve(); expect(activeStates[0]!()).toBe(true);
    owner.updateGhost(null); expect(activeStates[0]!()).toBe(false);
    const asset = model(pot); pending.resolve(asset); await owner.ready(); await Promise.resolve();
    expect(owner.ghostRoot.children).toHaveLength(0); expect(asset.dispose).toHaveBeenCalledOnce();
    owner.dispose(); Object.values(materials).forEach(material => material.dispose());
  });
  it("a cancelled then restarted same-item preview gets a fresh pending owner before the old load resolves", async () => {
    const first = deferred<RoadDecorationTemplate | undefined>(), second = deferred<RoadDecorationTemplate | undefined>();
    const load = vi.fn<DecorationAssetLoader>().mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const materials = createPlainBuildingMaterials(), world = huntingWorld();
    const owner = createThreeRoadDecorations(world, false, () => materials, load);
    const preview = { item: pot as typeof pot, position: [3, 2, 3] as [number, number, number], yaw: 0, valid: true };
    owner.updateGhost(preview); await Promise.resolve();
    owner.updateGhost(null); owner.updateGhost(preview); await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    const stale = model(pot), current = model(pot);
    first.resolve(stale); second.resolve(current); await owner.ready(); await Promise.resolve();
    expect(stale.dispose).toHaveBeenCalledOnce(); expect(current.dispose).not.toHaveBeenCalled();
    expect(owner.statistics().templates).toBe(1);
    owner.dispose(); expect(current.dispose).toHaveBeenCalledOnce();
    Object.values(materials).forEach(material => material.dispose());
  });

  it("shares code-family promises across map owners and does not poison retries after failure", async () => {
    const pending = deferred<{ createLoaderTestAsset: () => void }>();
    const load = vi.fn(() => pending.promise);
    const first = loadDecorationModule(load, "createLoaderTestAsset");
    expect(loadDecorationModule(load, "createLoaderTestAsset")).toBe(first);
    pending.resolve({ createLoaderTestAsset: () => {} }); await first;
    expect(load).toHaveBeenCalledOnce();
    const recover = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ createLoaderTestRecovery: () => {} });
    await expect(loadDecorationModule(recover, "createLoaderTestRecovery")).rejects.toThrow("offline");
    await expect(loadDecorationModule(recover, "createLoaderTestRecovery")).resolves.toHaveProperty("createLoaderTestRecovery");
    expect(recover).toHaveBeenCalledTimes(2);
  });

});
