import { InstancedMesh, Mesh, MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

/**
 * Owned plants render through the completion models (8c62e15cf): the species' authored atlas carries the blossom
 * colour, so copies share one instanced batch per surface without an instance tint.
 */
it("owned catalog plants share instanced completion surfaces, stay static and get a private hover", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const materials = createPlainBuildingMaterials(), borrowed = vi.fn();
  materials.bark.addEventListener("dispose", borrowed);
  const renderer = createThreeRoadDecorations(world, false, () => materials);
  const item = "roadDecoration:plant-cherry-blossom-roadside-ground-0:native";
  const frame = (uid: number, x: number): RoadDecorationFrame => ({ uid, item, yaw: Math.PI / 4,
    position: [x, 2, 5], volumes: [], supports: [] });
  const frames = [frame(1, 5), frame(2, 7)];
  try {
    renderer.update(frames); await renderer.ready();
    expect(renderer.statistics()).toMatchObject({ templates: 1, instances: 2 });
    const blossoms = renderer.root.children.find(node => node.name.endsWith("/flowering-blossoms")) as InstancedMesh;
    expect(blossoms).toBeInstanceOf(InstancedMesh); expect(blossoms.count).toBe(2);
    expect(blossoms.instanceColor).toBeNull();
    const material = blossoms.material as MeshStandardMaterial;
    expect(material.map).toBeTruthy(); expect(material.color.toArray()).toEqual([1, 1, 1]);
    const version = blossoms.instanceMatrix.version;
    for (let tick = 0; tick < 200; tick++) renderer.update(frames);
    await renderer.ready();
    expect(blossoms.instanceMatrix.version).toBe(version);
    renderer.setHover(1);
    const proxy = renderer.root.children.find(node => node.name === "road_decoration_hover_instance")!;
    const hoverBlossoms = proxy.getObjectByName("flowering-blossoms") as Mesh;
    expect(hoverBlossoms.geometry).toBe(blossoms.geometry);
    expect((hoverBlossoms.material as MeshStandardMaterial).color.r).toBeCloseTo(material.color.r * 1.5, 6);
    renderer.update([]); expect(renderer.hoverStatistics().uid).toBeNull();
    renderer.dispose(); renderer.dispose(); expect(borrowed).not.toHaveBeenCalled();
  } finally {
    renderer.dispose(); Object.values(materials).forEach(entry => entry.dispose());
  }
});
