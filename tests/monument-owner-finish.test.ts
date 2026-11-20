import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PropertyBinding } from "three";
import { expect, it } from "vitest";

import { finishMonumentArchitecture } from "../src/renderers/three/buildings/monument-owner-finish";

it("removes only Viking broad white slabs and retains real architectural feet and steps", () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const names = ["Courtyard.paving", "Courtyard.stone", "Foundation.stone", "Architecture.stone", "Door.Main.L.oak"];
  for (const name of names) { const mesh = new Mesh(geometry, material); mesh.name = PropertyBinding.sanitizeNodeName(name); root.add(mesh); }
  expect(finishMonumentArchitecture(root, "viking")).toEqual([]);
  expect(root.children.map(child => child.name)).toEqual(["Architecturestone", "DoorMainLoak"]);
  geometry.dispose(); material.dispose();
});

it("turns only the Roman interior entry backing into one recessed face, preserving actual doors", () => {
  const root = new Group(), geometry = new BoxGeometry(1.27, 1.85, .05), material = new MeshStandardMaterial();
  geometry.translate(0, 1.58, .56);
  const backing = new Mesh(geometry, material); backing.name = PropertyBinding.sanitizeNodeName("Architecture.recess"); root.add(backing);
  const door = new Mesh(geometry, material); door.name = "Door.Main.L.oak"; root.add(door);
  const owned = finishMonumentArchitecture(root, "roman");
  expect(owned).toHaveLength(1);
  expect(backing.geometry.index!.count / 3).toBe(2);
  expect(door.geometry).toBe(geometry);
  backing.geometry.computeBoundingBox();
  expect(backing.geometry.boundingBox!.min.z).toBeCloseTo(.53, 5);
  owned.forEach(value => value.dispose()); geometry.dispose(); material.dispose();
});
