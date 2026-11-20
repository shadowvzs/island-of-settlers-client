import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";
import { describe, expect, it } from "vitest";

import { createBuildingHover } from "../src/renderers/three/buildings/building-hover";

describe("shared world hover", () => {
  it("brightens the selected object and restores its shared material", () => {
    const scene = new Scene();
    const material = new MeshStandardMaterial({ color: 0x808080 });
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    const baseRed = material.color.r;
    scene.add(mesh);
    const hover = createBuildingHover(scene);

    hover.set(mesh);
    expect((mesh.material as MeshStandardMaterial).color.r).toBeCloseTo(baseRed * 1.5, 5);
    expect(hover.getStats().triangles).toBeGreaterThan(0);

    hover.clear();
    expect(mesh.material).toBe(material);
    expect(material.color.r).toBeCloseTo(baseRed, 5);
    hover.dispose();
  });

  it("can exclude helper meshes from both brightness and the outline", () => {
    const scene = new Scene();
    const material = new MeshStandardMaterial({ color: 0x808080 });
    const ring = new Mesh(new BoxGeometry(1, 1, 1), material);
    ring.name = "worker_selection_ring";
    scene.add(ring);
    const hover = createBuildingHover(scene, { exclude: mesh => mesh.name === "worker_selection_ring" });

    hover.set(ring);
    expect(ring.material).toBe(material);
    expect(hover.getStats()).toEqual({ meshes: 0, triangles: 0 });
    hover.dispose();
  });
});
