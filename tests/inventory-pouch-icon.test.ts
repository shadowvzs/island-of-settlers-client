import { DataTexture, Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getLauncherRows, selectBottomBar } from "../src/app/settlement-ui/hud/helpers";
import { getSettlementIconSource } from "../src/app/settlement-ui/icons";
import { createInventoryPouchIcon } from "../tools/bench/ui-action-icon-inventory";
import { disposeTree } from "../tools/bench/ui-action-icon-kit";

it("builds a closed soft leather body with outward normals, separate lining and a real tied drawstring", () => {
  const root = createInventoryPouchIcon();
  const body = root.getObjectByName("soft-leather-body") as Mesh;
  const lining = root.getObjectByName("folded-inner-neck") as Mesh;
  expect(body.isMesh).toBe(true); expect(lining.isMesh).toBe(true);
  const positions = body.geometry.getAttribute("position"), normals = body.geometry.getAttribute("normal");
  let frontNormals = 0;
  for (let i = 0; i < positions.count; i++) {
    expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
    if (positions.getZ(i) > .30 && Math.abs(positions.getX(i)) < .08) {
      expect(normals.getZ(i)).toBeGreaterThan(.6); frontNormals++;
    }
  }
  expect(frontNormals).toBeGreaterThan(10);
  for (const name of ["neck-double-drawstring-wrap", "left-tied-loop", "right-tied-loop",
    "left-cord-tail", "right-cord-tail", "cord-knot"]) {
    const cord = root.getObjectByName(name) as Mesh;
    expect(cord?.geometry.type).toBe("TubeGeometry");
    expect(cord.geometry.getAttribute("position").count).toBeGreaterThan(100);
  }
  const material = body.material as MeshStandardMaterial;
  expect((material.map as DataTexture).image.width).toBe(256); expect((material.normalMap as DataTexture).image.width).toBe(256);
  let normalDisposed = false;
  material.normalMap!.addEventListener("dispose", () => { normalDisposed = true; });
  disposeTree(root); expect(normalDisposed).toBe(true);
});
it("uses the distinct pouch icon only for the Inventory quick action and keeps Support last", () => {
  const rows = getLauncherRows(selectBottomBar({}));
  expect(rows.map(row => row.id)).toEqual(["build", "inventory", "map", "menu", "news", "support"]);
  expect(rows[1]).toMatchObject({ icon: "inventory", disabled: false });
  expect(getSettlementIconSource("inventory")).toContain("/actions/inventory.webp");
  expect(getSettlementIconSource("warehouse")).toContain("/actions/warehouse.webp");
  expect(getSettlementIconSource("inventory")).not.toBe(getSettlementIconSource("warehouse"));
});
