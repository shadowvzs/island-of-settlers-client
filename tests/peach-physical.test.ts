import { Box3, Euler, Vector3 } from "three";
import { expect, it } from "vitest";

import { createFloweringPeachGraph } from "../src/render-common/plants/flowering-peach-graph";
import { createPeachCrownLayout, floweringPeachClearanceVolumes } from "../src/render-common/plants/flowering-peach-physical";

it.each([0, 1, 2])("preserves the native-K capture layout exactly and encloses rotating crown sheets, variant %i", variant => {
  const graph = createFloweringPeachGraph(variant, true), layout = createPeachCrownLayout(graph);
  const volumes = floweringPeachClearanceVolumes(variant);
  const contains = (point: Vector3) => volumes.some(box => [0, 1, 2].every(axis =>
    point.getComponent(axis) >= box.min[axis]! - 1e-10 && point.getComponent(axis) <= box.max[axis]! + 1e-10));
  for (const [index, group] of graph.crownGroups.entries()) {
    // Independent original Three.js formulation used to bake K, before extraction to pure graph math.
    const bounds = new Box3();
    for (let limb = group.limbStart; limb < group.limbEnd; limb++)
      if (graph.limbs[limb]!.role === "twig")
        graph.limbs[limb]!.path.forEach(point => bounds.expandByPoint(new Vector3(...point)));
    for (let leaf = group.leafStart; leaf < group.leafEnd; leaf++) {
      const blade = graph.leaves[leaf]!, at = new Vector3(...blade.position);
      bounds.expandByPoint(at.clone().addScalar(blade.length));
      bounds.expandByPoint(at.clone().addScalar(-blade.length));
    }
    for (let flower = group.flowerStart; flower < group.flowerEnd; flower++)
      bounds.expandByPoint(new Vector3(...graph.blossoms[flower]!.position));
    const centre = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() * .53;
    expect(layout[index]).toEqual({ centre: centre.toArray(), radius });
    for (const pitch of [-1.3, -.5, 0, .5, 1.3]) for (let yaw = 0; yaw < 8; yaw++)
      for (const x of [-radius, radius]) for (const y of [-radius, radius]) {
        const corner = new Vector3(x, y, 0).applyEuler(new Euler(pitch, yaw * Math.PI / 4, 0)).add(centre);
        expect(contains(corner)).toBe(true);
      }
  }
  for (const flower of graph.blossoms) expect(contains(new Vector3(...flower.position))).toBe(true);
  // Avoid turning the raised crown's bounds into a wall across the surrounding ground.
  expect(contains(new Vector3(2.5, .5, 0))).toBe(false);
});
