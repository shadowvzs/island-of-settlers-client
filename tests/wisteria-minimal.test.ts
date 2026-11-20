import { Box3, InstancedMesh, Mesh, MeshStandardMaterial, Texture } from "three";
import { expect, it } from "vitest";

import { CART_STONE_LANE, HANDCART } from "../src/render-common/logistics/handcart-rules";
import { createWisteriaHero } from "../src/renderers/three/wisteria-hero";
import { groupWisteriaBotany, type WisteriaLodAtlasMetadata } from "../src/renderers/three/wisteria-lod-atlas";
import { createWisteriaMinimalTemplates } from "../src/renderers/three/wisteria-minimal-templates";

// Synthetic texture extents test ownership/topology only; they are not art/bake acceptance.
const metadata: WisteriaLodAtlasMetadata = {
  version: 2, racemeSpan: .30, spraySpan: .26,
  raceme: { min: [-.04, -.32, -.04], max: [.04, .05, .04] },
  spray: { min: [-.12, 0, -.07], max: [.12, .32, .07] },
  coverage: { racemeFront: .3, racemeSide: .3, fixedFront: .1, fixedSide: .1, sprayFront: .4, spraySide: .2 }
};

it.each(["curved", "lattice", "pergola"] as const)(
  "retains six woody stems and every pendant/spray below the Minimal cap (%s)", frame => {
  const atlas = new Texture(), templates = createWisteriaMinimalTemplates(atlas, metadata);
  const wood = new MeshStandardMaterial();
  const model = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0], templates, { minimal: true, frame });
  expect(model.counts).toEqual({ flowers: 560, buds: 140, leaflets: 702, racemes: 28, mainStems: 6 });
  expect(groupWisteriaBotany(model.botany.flowers, "cluster")).toHaveLength(28);
  expect(groupWisteriaBotany(model.botany.leaves, "spray")).toHaveLength(54);
  let triangles = 0;
  model.root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3 *
      (node instanceof InstancedMesh ? node.count : 1);
  });
  expect(triangles).toBeLessThanOrEqual(2300);
  expect(new Box3().setFromObject(model.root).min.y).toBeGreaterThanOrEqual(0);
  expect((model.root.getObjectByName("wisteria_minimal_neutral_racemes") as InstancedMesh).count).toBe(28);
  model.dispose(); templates.dispose(); wood.dispose();
});

it("shares every dense silhouette buffer/neutral atlas between differently coloured placements", () => {
  const atlas = new Texture(), templates = createWisteriaMinimalTemplates(atlas, metadata);
  const flowers = [{ position: [0, 1, 0] as const, yaw: 0, scale: .065, cluster: 0, clusterOrigin: [0, 1, 0] as const },
    { position: [0, .7, 0] as const, yaw: 0, scale: .035, cluster: 0, clusterOrigin: [0, 1, 0] as const }];
  const purple = templates.instantiate(flowers, []), white = templates.instantiate(flowers, [], [1, 1, 1]);
  const left = purple.root.children[0] as InstancedMesh, right = white.root.children[0] as InstancedMesh;
  expect(left.geometry).toBe(right.geometry); expect(left.material).toBe(right.material);
  expect(left.instanceColor!.getX(0)).not.toBe(right.instanceColor!.getX(0));
  expect((purple.root.children[1] as InstancedMesh).instanceColor).toBeNull();
  let freed = 0; atlas.addEventListener("dispose", () => { freed++; });
  purple.dispose(); expect(freed).toBe(0);
  templates.dispose(); templates.dispose(); white.dispose();
  expect(freed).toBe(1); expect(white.root.children).toHaveLength(0);
});

it("batches whole Minimal templates across placements while separating tint from fixed green surfaces", async () => {
  const { Matrix4 } = await import("three");
  const { createWisteriaPopulationTemplates } = await import("../src/renderers/three/wisteria-population-templates");
  const atlas = new Texture(), templates = createWisteriaMinimalTemplates(atlas, metadata), wood = new MeshStandardMaterial();
  const source = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0], templates,
    { minimal: true, flowerPalette: [1, 1, 1] });
  const population = createWisteriaPopulationTemplates({ root: source.root, dispose: () => {
    source.dispose(); templates.dispose(); wood.dispose();
  } }, mesh => mesh.name === "wisteria_minimal_neutral_racemes");
  expect(population.triangles).toBeLessThanOrEqual(2300);
  const first = population.create(128), second = population.create(32);
  for (let index = 0; index < 128; index++)
    first.set(index, new Matrix4().makeTranslation(index % 16 * 4, 0, Math.floor(index / 16) * 4), [.8, .6, 1]);
  first.commit();
  const neutral = first.root.getObjectByName("wisteria_population_neutral_flowers") as InstancedMesh;
  expect(neutral.count).toBe(128);
  expect(first.root.children.filter(node => (node as InstancedMesh).instanceColor)).toHaveLength(1);
  const a = first.root.children[0] as InstancedMesh, b = second.root.children[0] as InstancedMesh;
  expect(a.geometry).toBe(b.geometry);
  let freed = 0; a.geometry.addEventListener("dispose", () => { freed++; });
  first.dispose(); expect(freed).toBe(0);
  population.dispose(); population.dispose(); second.dispose();
  expect(freed).toBe(1); expect(second.root.children).toHaveLength(0);
});

it("checks true three-dimensional support contact while retaining the cart traffic envelope", async () => {
  const { Vector3 } = await import("three");
  const { createWisteriaGeometryClearance } = await import("../src/renderers/three/wisteria-geometry-clearance");
  const wood = new MeshStandardMaterial();
  const model = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0]);
  const solid = createWisteriaGeometryClearance(model.root);
  expect(solid.intersects(new Box3(new Vector3(.90, .3, -.10), new Vector3(1.10, .6, .10)))).toBe(true);
  // Canonical two-cart body edges plus margin, not a claimed mounted actor height.
  const width = CART_STONE_LANE + HANDCART.width / 2 + HANDCART.clearance;
  expect(solid.intersects(new Box3(new Vector3(-width, .001, -.8), new Vector3(width, 1.2, .8)))).toBe(false);
  model.dispose(); wood.dispose();
});

// New botanical roots/phase must not silently reuse the former architectural-row atlas.
it("rejects an old composition atlas before creating Minimal GPU resources", () => {
  const atlas = new Texture();
  expect(() => createWisteriaMinimalTemplates(atlas, { ...metadata, version: 1 as 2 }))
    .toThrow("Unsupported Wisteria LOD atlas");
  atlas.dispose();
});
