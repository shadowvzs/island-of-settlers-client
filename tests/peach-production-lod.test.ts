import { DataTexture, Mesh, MeshStandardMaterial, Texture, TextureLoader } from "three";
import { expect, it, vi } from "vitest";

import { createFloweringPeachGraph } from "../src/render-common/plants/flowering-peach-graph";
import { createPeachBlossomTreeTemplates } from "../src/renderers/three/plants/peach-blossom-tree-templates";
import { createPeachCrownImpostorMaterial } from "../src/renderers/three/plants/peach-crown-impostor";
import { selectPeachCrownDetails } from "../src/renderers/three/plants/peach-crown-layout";
import { loadPeachProductionResources } from "../src/renderers/three/plants/peach-production-resources";
import { createPeachTreeImpostorMaterial } from "../src/renderers/three/plants/peach-tree-impostor";
import { createPeachTreeInspectionModel } from "../src/renderers/three/plants/peach-tree-inspection-model";
import { createPeachTreeMaterials } from "../src/renderers/three/plants/peach-tree-materials";
import { createFloweringPeachProductionModel } from "../src/renderers/three/plants/peach-tree-production-model";

it("requires original canonical imagery and produces a flat, bounded two-triangle production template", () => {
  const pack = createPeachTreeMaterials(), atlas = new DataTexture(), impostor = createPeachTreeImpostorMaterial(atlas);
  expect(() => createFloweringPeachProductionModel(pack.materials, false)).toThrow(/canonical-rendered/);
  const disposed = vi.fn(), atlasDisposed = vi.fn(), depthDisposed = vi.fn();
  impostor.userData.peachDepthMaterial.addEventListener("dispose", depthDisposed);
  impostor.addEventListener("dispose", disposed); atlas.addEventListener("dispose", atlasDisposed);
  for (const detailed of [true, false]) {
    const model = createFloweringPeachProductionModel({ ...pack.materials, impostor }, detailed);
    expect(model.root.children).toHaveLength(1);
    const mesh = model.root.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh); expect(mesh.material).toBe(impostor);
    expect(model.individualFlowers).toBe(0); expect(model.heroFlowers).toBe(0);
    expect(model.representedFlowers).toBe(5376);
    expect(model.triangles).toBe(2); expect(model.budgetPassed).toBe(true);
    expect(mesh.geometry.boundingSphere!.center.y + mesh.geometry.boundingSphere!.radius).toBeGreaterThan(5.8);
    model.dispose(); model.dispose();
  }
  expect(disposed).not.toHaveBeenCalled(); expect(atlasDisposed).not.toHaveBeenCalled();
  expect(depthDisposed).not.toHaveBeenCalled();
  impostor.dispose(); impostor.dispose(); expect(depthDisposed).toHaveBeenCalledTimes(1);
  atlas.dispose(); pack.dispose();
});

it.each([true, false])("keeps genuine supported near details inside normal production caps; High=%s", detailed => {
  const pack = createPeachTreeMaterials(), templates = createPeachBlossomTreeTemplates(detailed);
  const texture = new DataTexture(), crowns = createPeachCrownImpostorMaterial(texture);
  const released = vi.fn(); templates.hero.petals.addEventListener("dispose", released);
  const model = createFloweringPeachProductionModel({ ...pack.materials, crowns }, detailed, 1, "near", templates);
  expect(model.individualFlowers).toBe(detailed ? 144 : 48);
  expect(model.heroFlowers).toBe(detailed ? 24 : 16);
  expect(model.representedFlowers).toBe(5376); expect(model.realLeaves).toBe(detailed ? 64 : 12);
  expect(model.root.children).toHaveLength(4);
  expect(model.root.children.every(child => child instanceof Mesh)).toBe(true);
  const triangles = model.root.children.reduce((sum, child) => {
    const geometry = (child as Mesh).geometry;
    return sum + (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
  }, 0);
  expect(triangles).toBe(model.triangles);
  expect(triangles).toBeLessThanOrEqual(detailed ? 24000 : 6000); expect(model.budgetPassed).toBe(true);
  const graph = createFloweringPeachGraph(1, true), selection = selectPeachCrownDetails(graph, detailed);
  for (const index of selection.flowers) {
    let bearing: number | null = graph.flowerBearings[index]!;
    while (bearing !== null) { expect(selection.wood.has(bearing)).toBe(true); bearing = graph.limbs[bearing]!.parent; }
  }
  const capture = model.root.children.find(child => child.name === "peach-original-crown-masses") as Mesh;
  const centres = capture.geometry.getAttribute("peachCentre");
  const depths = Array.from({ length: centres.count }, (_, index) => centres.getZ(index));
  expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(.5);
  model.dispose(); model.dispose(); expect(released).not.toHaveBeenCalled();
  templates.dispose(); expect(released).toHaveBeenCalledTimes(1); crowns.dispose(); texture.dispose(); pack.dispose();
});

it("shares asynchronously loaded atlases and releases partial, cancelled and successful resource owners", async () => {
  const textures = Array.from({ length: 6 }, () => new Texture<HTMLImageElement>());
  const released = textures.map(texture => {
    const listener = vi.fn(); texture.addEventListener("dispose", listener); return listener;
  });
  const loader = new TextureLoader();
  vi.spyOn(loader, "loadAsync").mockImplementation(async url => {
    if (url === "failure") throw new Error("missing atlas");
    return textures[Number(url)]!;
  });
  await expect(loadPeachProductionResources(["0", "failure", "2"], false, undefined, loader)).rejects.toThrow(/atlases/);
  expect(released[0]).toHaveBeenCalledTimes(1); expect(released[2]).toHaveBeenCalledTimes(1);
  const abort = new AbortController(); abort.abort();
  await expect(loadPeachProductionResources(["0", "1", "2"], false, abort.signal, loader)).rejects.toMatchObject({ name: "AbortError" });
  const inFlightAbort = new AbortController(), cancellationLoader = new TextureLoader();
  vi.spyOn(cancellationLoader, "loadAsync").mockImplementation(async url => {
    if (url === "0") inFlightAbort.abort();
    return textures[Number(url)]!;
  });
  const cancellationCounts = released.map(listener => listener.mock.calls.length);
  await expect(loadPeachProductionResources(["0", "1", "2"], false, inFlightAbort.signal, cancellationLoader))
    .rejects.toMatchObject({ name: "AbortError" });
  for (const index of [0, 1, 2]) expect(released[index]).toHaveBeenCalledTimes(cancellationCounts[index]! + 1);
  const owner = await loadPeachProductionResources({ far: ["0", "1", "2"], crowns: ["3", "4", "5"] }, false, undefined, loader);
  expect(owner.nearReady).toBe(true);
  const first = owner.materialsForVariant(0), second = owner.materialsForVariant(1);
  expect(first.bark).toBe(second.bark); expect(first.impostor).not.toBe(second.impostor);
  const counts = released.map(listener => listener.mock.calls.length);
  owner.dispose(); owner.dispose(); expect(owner.nearReady).toBe(false);
  expect(() => owner.materialsForVariant(0)).toThrow(/disposed/);
  released.forEach((listener, index) => expect(listener).toHaveBeenCalledTimes(counts[index]! + 1));
});

it("keeps the full3D export source free of runtime billboard shader dependencies", () => {
  const pack = createPeachTreeMaterials(), templates = createPeachBlossomTreeTemplates(false);
  const model = createPeachTreeInspectionModel(pack.materials, false, 0, templates);
  expect(model.individualFlowers).toBe(5376); expect(model.inspectionOnly).toBe(true);
  expect(model.productionBudgetPassed).toBe(false);
  expect(model.root.children.every(child => child instanceof Mesh && child.material instanceof MeshStandardMaterial)).toBe(true);
  const triangleCount = model.root.children.reduce((total, child) => {
    const geometry = (child as Mesh).geometry;
    return total + (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
  }, 0);
  expect(triangleCount).toBe(model.triangles); expect(triangleCount).toBeGreaterThan(129024);
  model.dispose(); templates.dispose(); pack.dispose();
});
