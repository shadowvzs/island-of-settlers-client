import { Group, InstancedBufferGeometry, InstancedMesh, Mesh, Raycaster, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import type { RoadDecorationBounds } from "../src/render-common/road-decoration-clearance";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

const frame = (uid: number, x = 5, z = 5): RoadDecorationFrame => ({ uid,
  item: "roadDecoration:indigenous-flower-pot:native", position: [x, 2, z], yaw: 0,
  volumes: [], supports: [] });

it("one thousand static decorations share templates/chunk batches and unchanged updates do not upload matrices", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const materials = createPlainBuildingMaterials(), borrowed = vi.fn();
  materials.leaf.addEventListener("dispose", borrowed);
  const owner = createThreeRoadDecorations(world, false, () => materials);
  try {
    const frames = Array.from({ length: 1_000 }, (_, index) => frame(index + 1, 2 + index % 10, 2 + Math.floor(index / 10) % 10));
    owner.update(frames); await owner.ready();
    expect(owner.statistics()).toMatchObject({ templates: 1, instances: 1_000 });
    expect(owner.statistics().batches).toBeLessThanOrEqual(5);
    const meshes = owner.root.children as InstancedMesh[], versions = meshes.map(mesh => mesh.instanceMatrix.version);
    for (let tick = 0; tick < 200; tick++) owner.update(frames); await owner.ready();
    expect(meshes.map(mesh => mesh.instanceMatrix.version)).toEqual(versions);
    expect(new Set(meshes.map(mesh => mesh.geometry)).size).toBe(meshes.length);
    owner.update([frame(7)]); owner.root.updateMatrixWorld(true);
    const hit = owner.pick(new Raycaster(new Vector3(5, 2.14, 8), new Vector3(0, 0, -1)));
    expect(hit?.uid).toBe(7);
    owner.update([]); expect(owner.statistics()).toMatchObject({ templates: 1, instances: 0, batches: 0 });
    owner.dispose(); owner.dispose(); expect(borrowed).not.toHaveBeenCalled();
  } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
});

it("rebuilds one contact decal per decoration only when the visible set changes", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const materials = createPlainBuildingMaterials();
  const owner = createThreeRoadDecorations(world, false, () => materials, undefined, {});
  try {
    const frames: RoadDecorationFrame[] = [frame(1), frame(2, 7), frame(3, 9)].map(entry => {
      const bounds: RoadDecorationBounds = {
        min: [entry.position[0] - 1, 0, entry.position[2] - 1],
        max: [entry.position[0] + 1, 1, entry.position[2] + 1]
      };
      return { ...entry, volumes: [bounds] };
    });
    owner.update(frames); await owner.ready();
    const contact = owner.root.children.find(node =>
      node.name === "road-decoration-contact-shadows") as Mesh<InstancedBufferGeometry>;
    expect(contact).toBeDefined();
    expect(contact.geometry.instanceCount).toBe(3);
    const attribute = contact.geometry.getAttribute("contact");
    expect(attribute.count).toBeGreaterThanOrEqual(3);
    owner.update(frames); await owner.ready();
    expect(contact.geometry.instanceCount).toBe(3);
    owner.update([frames[0]!]); await owner.ready();
    expect(contact.geometry.instanceCount).toBe(1);
  } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
});

it("rotated instances pick their actual UID and highlight only one cached proxy, clearing with fog/removal/disposal", async () => {
  const world = huntingWorld(); world.fogDisplayDisabled = true;
  const materials = createPlainBuildingMaterials(), owner = createThreeRoadDecorations(world, false, () => materials);
  const frames = [{ ...frame(7), yaw: Math.PI / 4 }, { ...frame(8, 8), yaw: Math.PI / 2 }];
  try {
    owner.update(frames); await owner.ready(); owner.root.updateMatrixWorld(true);
    expect(owner.pick(new Raycaster(new Vector3(5, 2.14, 8), new Vector3(0, 0, -1)))?.uid).toBe(7);
    expect(owner.setHover(7)).toBe(true);
    const proxy = owner.root.children.find(node => node.name === "road_decoration_hover_instance") as Group;
    expect(proxy.position.toArray()).toEqual([5, 2, 5]); expect(proxy.rotation.y).toBe(Math.PI / 4);
    const meshes = proxy.children.filter((node): node is Mesh => node instanceof Mesh);
    const geometry = meshes.map(mesh => mesh.geometry), material = meshes.map(mesh => mesh.material);
    const disposed = [...new Set(material.flat())].map(material => { const callback = vi.fn(); material.addEventListener("dispose", callback); return callback; });
    const batchMaterials = owner.root.children.filter((node): node is InstancedMesh => node instanceof InstancedMesh).map(node => node.material);
    for (let tick = 0; tick < 500; tick++) owner.setHover(7);
    expect(meshes.map(mesh => mesh.geometry)).toEqual(geometry); expect(meshes.map(mesh => mesh.material)).toEqual(material);
    expect(owner.setHover(8)).toBe(true); expect(proxy.position.toArray()).toEqual([8, 2, 5]);
    expect(owner.hoverStatistics()).toEqual({ uid: 8, templates: 1 });
    expect(owner.root.children.filter((node): node is InstancedMesh => node instanceof InstancedMesh).map(node => node.material)).toEqual(batchMaterials);
    world.fogDisplayDisabled = false; world.fog = new Uint8Array(world.cellsX * world.cellsZ); world.fogRevision = (world.fogRevision ?? 0) + 1;
    owner.update(frames); await owner.ready(); expect(owner.hoverStatistics().uid).toBeNull(); expect(proxy.visible).toBe(false);
    expect(owner.setHover(8)).toBe(false);
    world.fogDisplayDisabled = true; world.fogRevision++; owner.update(frames); await owner.ready(); owner.setHover(7);
    owner.update([frames[1]!]); expect(owner.hoverStatistics().uid).toBeNull();
    owner.dispose(); owner.dispose();
    for (const callback of disposed) expect(callback).toHaveBeenCalledOnce();
    expect(owner.hoverStatistics()).toEqual({ uid: null, templates: 0 });
  } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
});
