import { DataTexture, MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { createRoadDecorationStoneMaterial } from "../src/renderers/three/road-decoration-stone-material";
import type { RoadDecorationStoneFamily } from "../src/shared/settlement/road-decoration-catalog";

it("shares family maps across templates and releases only after the final owning template", () => {
  const source = new MeshStandardMaterial(), first = createRoadDecorationStoneMaterial(source, true, "granite");
  const second = createRoadDecorationStoneMaterial(source, true, "granite"), map = first.map as DataTexture;
  const released = vi.fn(); map.addEventListener("dispose", released);
  expect(second.map).toBe(map); expect(second.normalMap).toBe(first.normalMap);
  first.dispose(); expect(released).not.toHaveBeenCalled(); expect(map.image.data?.length).toBeGreaterThan(0);
  second.dispose(); expect(released).toHaveBeenCalledTimes(1); expect(map.image.data).toBeNull();
  const fresh = createRoadDecorationStoneMaterial(source, true, "granite");
  expect(fresh.map).not.toBe(map); fresh.dispose(); source.dispose();
});

it.each([true, false])("preserves distinct family mineral structure in High=%s", detailed => {
  const source = new MeshStandardMaterial();
  const materials = (["limestone", "granite", "marble"] as RoadDecorationStoneFamily[])
    .map(family => createRoadDecorationStoneMaterial(source, detailed, family));
  try {
    const signatures = materials.map(material => {
      const bytes = (material.map as DataTexture).image.data!;
      return Array.from(bytes.slice(0, 96)).join(",");
    });
    expect(new Set(signatures).size).toBe(3);
    for (const material of materials) {
      if (detailed) {
        const normals = (material.normalMap as DataTexture).image.data!;
        expect(new Set(Array.from(normals).filter((_, index) => index % 4 === 0)).size).toBeGreaterThan(3);
        expect(material.roughnessMap).not.toBeNull();
      } else expect(material.normalMap).toBeNull();
    }
  } finally { materials.forEach(material => material.dispose()); source.dispose(); }
});
