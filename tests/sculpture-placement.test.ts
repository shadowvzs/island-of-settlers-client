import { Group, Vector3 } from "three";
import { expect, it } from "vitest";

import { createPhoenixSculptureRecipe } from "../src/render-common/props/national-sculptures/phoenix-sculpture";
import { createCulturalSculpture } from "../src/renderers/three/props/cultural-sculptures";
import { createSculptureFeatherGeometry } from "../src/renderers/three/props/sculpture-feather";
import { visibleTriangles } from "./helpers/visible-mesh-bounds";

it("closed feather vanes face outward on their convex front surface", () => {
  const geometry = createSculptureFeatherGeometry([[0, 1, 0], [0, .5, 0], [0, 0, 0]], .1, true);
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  let front = 0;
  for (let index = 1; index < positions.count; index++) if (positions.getZ(index) > positions.getZ(front)) front = index;
  expect(normals.getZ(front)).toBeGreaterThan(.9);
  geometry.dispose();
});

it.each([true, false])("all displayed primary feathers meet a continuous wing structure (High=%s)", detailed => {
  const asset = createCulturalSculpture("phoenix", detailed, false, "ornament"), wings = new Group();
  for (const object of asset.root.children.filter(part => part.name === "phoenix_display_wing_bone")) wings.add(object);
  const triangles = visibleTriangles(wings), nearest = new Vector3();
  expect(wings.children).toHaveLength(2);
  const recipe = createPhoenixSculptureRecipe(detailed, "ornament");
  for (const part of recipe.parts) if (part.name === "phoenix_primary_feather" && part.geometry.shape.kind === "feather") {
    const root = new Vector3(...part.geometry.shape.points[0]!);
    const distance = Math.min(...triangles.map(triangle => triangle.closestPointToPoint(root, nearest).distanceTo(root)));
    expect(distance).toBeLessThan(.065);
  }
  asset.root.add(...wings.children); asset.dispose();
});
