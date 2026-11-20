import { DataTexture, Mesh } from "three";
import { afterEach, expect, it, vi } from "vitest";

import { getRoadDecorationItem } from "../../island-of-settlers-shared/src/road-decoration-items";
import {
  createOrnamentalPlantOverview,
  type OrnamentalOverviewManifest
} from "../src/renderers/three/plants/ornamental-plant-overview";

const id = "roadDecoration:plant-bonsai-maple-roadside-pot-0:native";
const asset = getRoadDecorationItem(id)!.plant!;
const image = { image: "plant-bonsai-maple-roadside-pot-0-native.png", width: 1.8,
  height: 1.8, pivot: [.44, .15] as const };
const manifest: OrnamentalOverviewManifest = { [id]: image };
afterEach(() => vi.unstubAllGlobals());

it("uses two calibrated triangles and pins the original icon ground contact to the instance origin", async () => {
  const texture = new DataTexture(), loadTexture = vi.fn(async () => texture);
  const model = await createOrnamentalPlantOverview(asset, () => true, {
    baseUrl: "/island/", loadManifest: async () => manifest, loadTexture
  });
  expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
    "/island/icons/road-decorations/plant-bonsai-maple-roadside-pot-0-native.png");
  expect(model?.triangles).toBe(2); expect(model?.root.children).toHaveLength(1);
  const mesh = model!.root.children[0] as Mesh;
  expect(mesh).toBeInstanceOf(Mesh); expect(mesh.geometry.index!.count).toBe(6);
  const positions = mesh.geometry.getAttribute("position"), uv = mesh.geometry.getAttribute("uv");
  for (let vertex = 0; vertex < positions.count; vertex++) {
    expect(positions.getX(vertex)).toBeCloseTo((uv.getX(vertex) - image.pivot[0]) * image.width, 6);
    expect(positions.getY(vertex)).toBeCloseTo((uv.getY(vertex) - image.pivot[1]) * image.height, 6);
    expect(positions.getZ(vertex)).toBe(0);
    expect(Math.hypot(positions.getX(vertex), positions.getY(vertex)))
      .toBeLessThanOrEqual(mesh.geometry.boundingSphere!.radius + 1e-6);
  }
  expect(mesh.geometry.boundingSphere!.center.toArray()).toEqual([0, 0, 0]);
  expect(mesh.geometry.boundingBox!.max.z).toBeGreaterThan(0); // Shader-facing orientations stay cullable.
  expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(false);
  model!.dispose();
});

it("owns icon, geometry and material exactly once without mutating canonical asset metadata", async () => {
  const original = structuredClone(asset), texture = new DataTexture();
  const model = await createOrnamentalPlantOverview(asset, () => true, {
    loadManifest: async () => manifest, loadTexture: async () => texture
  });
  const mesh = model!.root.children[0] as Mesh;
  const geometryDisposed = vi.fn(), materialDisposed = vi.fn(), textureDisposed = vi.fn();
  mesh.geometry.addEventListener("dispose", geometryDisposed);
  if (Array.isArray(mesh.material)) throw new Error("Overview requires one instanced material");
  mesh.material.addEventListener("dispose", materialDisposed);
  texture.addEventListener("dispose", textureDisposed);
  model!.dispose(); model!.dispose();
  expect(geometryDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).toHaveBeenCalledOnce();
  expect(textureDisposed).toHaveBeenCalledOnce(); expect(model!.root.children).toHaveLength(0);
  expect(asset).toEqual(original);
});

it("cancels before allocation and releases a texture whose async owner became obsolete", async () => {
  const loadManifest = vi.fn(async () => manifest), texture = new DataTexture();
  let complete!: (value: DataTexture) => void, active = true;
  const loadTexture = vi.fn(() => new Promise<DataTexture>(resolve => { complete = resolve; }));
  expect(await createOrnamentalPlantOverview(asset, () => false, { loadManifest, loadTexture })).toBeUndefined();
  expect(loadManifest).not.toHaveBeenCalled();
  const pending = createOrnamentalPlantOverview(asset, () => active, { loadManifest, loadTexture });
  await vi.waitFor(() => expect(loadTexture).toHaveBeenCalledOnce());
  const disposed = vi.fn(); texture.addEventListener("dispose", disposed);
  active = false; complete(texture);
  expect(await pending).toBeUndefined(); expect(disposed).toHaveBeenCalledOnce();
});

it("rejects missing or miscalibrated actual renders before loading any placeholder texture", async () => {
  const loadTexture = vi.fn(async () => new DataTexture());
  for (const entry of [undefined, { ...image, width: 0 }, { ...image, image: "other.png" },
    { ...image, pivot: [1.5, .15] }]) {
    const entries = entry ? { [id]: entry } : {};
    await expect(createOrnamentalPlantOverview(asset, () => true, {
      loadManifest: async () => entries as OrnamentalOverviewManifest, loadTexture
    })).rejects.toThrow(/Missing or invalid/);
  }
  expect(loadTexture).not.toHaveBeenCalled();
});

it("retries a failed shared manifest and reuses a successful metadata fetch across templates", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("temporary network failure"))
    .mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const dependencies = { baseUrl: "/game/", loadTexture: async () => new DataTexture() };
  await expect(createOrnamentalPlantOverview(asset, () => true, dependencies)).rejects.toThrow(/temporary/);
  const first = await createOrnamentalPlantOverview(asset, () => true, dependencies);
  const second = await createOrnamentalPlantOverview(asset, () => true, dependencies);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith("/game/icons/road-decorations/ornamental-overview.json");
  first!.dispose(); second!.dispose();
});

it("loads a scalar structural ID with its exact calibrated render and retries an older manifest missing that ID", async () => {
  const scalar = "roadDecoration:wisteria-curved:native";
  const entry = { ...image, image: "wisteria-curved-native.png", width: 5, height: 5 };
  vi.resetModules();
  const { createOrnamentalPlantOverview: create } = await import("../src/renderers/three/plants/ornamental-plant-overview");
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ [scalar]: entry }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const loadTexture = vi.fn(async () => new DataTexture());
  const old = await create(asset, () => true, { baseUrl: "/game/", loadTexture }); old!.dispose();
  loadTexture.mockClear();
  await expect(create(scalar, () => true, { baseUrl: "/game/", loadTexture })).rejects.toThrow(/Missing or invalid/);
  const model = await create(scalar, () => true, { baseUrl: "/game/", loadTexture });
  expect(model!.triangles).toBe(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(loadTexture).toHaveBeenCalledExactlyOnceWith("/game/icons/road-decorations/wisteria-curved-native.png");
  expect(getRoadDecorationItem(scalar)!.shopAvailable).toBe(true);
  model!.dispose();
});
