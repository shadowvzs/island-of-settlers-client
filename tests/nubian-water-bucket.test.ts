import { Box3, type CylinderGeometry, type Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { handledWaterBucketScale, WATER_WARE_SCALE } from "../src/render-common/wares/water-bucket-dimensions";
import { createRomanWaterStock } from "../src/renderers/three/buildings/roman-water-stock";
import { disposeMeshGeometries } from "../src/renderers/three/three-mesh-resources";
import { createWorkerWellBucket } from "../src/renderers/three/worker-well-bucket";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("Nubian drawing/carry/stock vessels share a genuinely round tapered body, rim, water and fitted floor", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) {
      const bucket = createWorkerWellBucket(materials, detailed, true, "nubian");
      try {
        const body = bucket.getObjectByName("well_nubian_bucket_body") as Mesh;
        const points = body.geometry.getAttribute("position"), topAngles = new Set<number>();
        let bottomRadius = 0, topRadius = 0;
        for (let index = 0; index < points.count; index++) {
          const y = points.getY(index), radius = Math.hypot(points.getX(index), points.getZ(index));
          if (y > .069) { topRadius = Math.max(topRadius, radius);
            topAngles.add(Math.round(Math.atan2(points.getX(index), points.getZ(index)) * 10000)); }
          if (y < -.069) bottomRadius = Math.max(bottomRadius, radius);
        }
        expect(topAngles.size).toBeGreaterThanOrEqual(detailed ? 16 : 12);
        expect(topRadius).toBeCloseTo(.09, 5); expect(bottomRadius).toBeCloseTo(.072, 5);
        const water = bucket.getObjectByName("well_bucket_water") as Mesh<CylinderGeometry>;
        expect(water.geometry.parameters.radialSegments).toBe(detailed ? 16 : 12);
        const bounds = new Box3().setFromObject(bucket), size = bounds.getSize(new Vector3());
        expect(size.x).toBeCloseTo(.18, 5); expect(size.z).toBeCloseTo(.18, 5);
        expect(size.y).toBeCloseTo(.23, 5);
      } finally { disposeMeshGeometries(bucket); bucket.userData.disposeOwnedMaterials(); }
      const stock = createRomanWaterStock(materials, detailed, false, "nubian");
      try {
        const size = new Box3().setFromObject(stock.root).getSize(new Vector3());
        const scale = handledWaterBucketScale(WATER_WARE_SCALE);
        expect(size.x).toBeCloseTo(.18 * scale.x, 5);
        expect(size.z).toBeCloseTo(.18 * scale.z, 5);
        expect(size.y).toBeCloseTo(.23 * scale.y, 5);
      } finally { stock.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
