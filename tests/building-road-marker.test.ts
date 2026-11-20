import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import type { BuildingFrame } from "../src/render-common/buildings/building-catalog";
import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics, getRomanBuildingGridMetrics }
  from "../src/render-common/buildings/building-grid-metrics";
import { BUILDING_SIGNPOST_END_SETBACK, BUILDING_SIGNPOST_SIDE_OFFSET, getPlacedBuildingSignpost }
  from "../src/render-common/buildings/building-road-signpost";
import { createBuildingRoadMarkers } from "../src/renderers/three/buildings/building-road-marker";
import { ROAD_WIDTH } from "../src/shared/settlement/road-types";

const frameFor = (type = 17, quarterTurns = 0, construction = 1): BuildingFrame => ({
  construction, door: 0, id: "test-building", rotation: quarterTurns * Math.PI / 2,
  type, working: false, x: 20.5, y: 2, z: 30
});

it("hides the connection marker and signpost on neutral archer scaffolds", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  markers.update(marker, { ...frameFor(4), bandit: { code: 1, layout: 0 }, owner: 1 });
  expect(marker.visible).toBe(false);
  markers.update(marker, frameFor(4));
  expect(marker.visible).toBe(true);
  markers.dispose();
});

it("marks the exact snapped road connection at all building rotations and terrain heights", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  for (const type of [0, 17, 35, 39]) for (const rotation of [0, 1, 2, 3]) {
    const frame = { type, x: 20.5, y: 2, z: 30, rotation: rotation * Math.PI / 2 } as BuildingFrame;
    const height = (x: number, z: number) => x * .05 + z * .02;
    markers.update(marker, frame, { sample: height });
    const { road } = getPlacedBuildingLogistics(type, frame.x, frame.z, rotation);
    expect(marker.position.x).toBe(road.x);
    expect(marker.position.z).toBe(road.z);
    expect(marker.position.y).toBeCloseTo(height(road.x, road.z) + .028);
  }
  markers.dispose();
});

it("places every building sign behind the connection, opposite carrier approach, outside either road ribbon", () => {
  for (const { id: type } of BUILDING_CATALOG) {
    const { logistics } = getRomanBuildingGridMetrics(getBuildingDefinition(type));
    const carrierSide = Math.sign(logistics.carrierApproach[0] - logistics.doorThreshold[0]) || -1;
    for (const quarterTurns of [0, 1, 2, 3, -1]) {
      const { post, road, rotation, side } = getPlacedBuildingSignpost(type, 20.5, 30, quarterTurns);
      const dx = post.x - road.x, dz = post.z - road.z;
      const lateral = dx * Math.cos(rotation) - dz * Math.sin(rotation);
      const forward = dx * Math.sin(rotation) + dz * Math.cos(rotation);
      expect(side).toBe(-carrierSide);
      expect(lateral).toBeCloseTo(side * BUILDING_SIGNPOST_SIDE_OFFSET);
      expect(forward).toBeCloseTo(-BUILDING_SIGNPOST_END_SETBACK);
      expect(Math.abs(lateral) - .041).toBeGreaterThan(ROAD_WIDTH / 2);
      expect(Math.abs(forward) - .041).toBeGreaterThan(ROAD_WIDTH / 2);
    }
  }
});

it("shows construction-site signs immediately and reuses both icons after completion", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  const post = marker.getObjectByName("building_road_signpost")!;
  markers.update(marker, frameFor(17, 0, 0));
  expect(post.visible).toBe(true);
  expect(post.children).toHaveLength(4);
  const front = post.getObjectByName("building_signpost_icon_front");
  markers.update(marker, frameFor());
  expect(post.visible).toBe(true);
  expect(post.children).toHaveLength(4);
  expect(post.getObjectByName("building_signpost_icon_front")).toBe(front);
  expect(front).toBeInstanceOf(Mesh);
  expect(post.getObjectByName("building_signpost_icon_back")!.rotation.y).toBe(Math.PI);
  markers.update(marker, frameFor(17, 2));
  expect(post.children).toHaveLength(4);
  markers.dispose();
});

it("roots posts in their own sampled terrain at all rotations rather than floating at endpoint height", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  const sample = (x: number, z: number) => x * .05 + z * .02;
  for (const quarterTurns of [0, 1, 2, 3]) {
    const frame = frameFor(0, quarterTurns, 0);
    const placement = getPlacedBuildingSignpost(frame.type, frame.x, frame.z, quarterTurns);
    markers.update(marker, frame, { sample });
    marker.updateMatrixWorld(true);
    const post = marker.getObjectByName("building_road_signpost")!;
    const position = post.getWorldPosition(new Vector3());
    expect(position.x).toBeCloseTo(placement.post.x);
    expect(position.z).toBeCloseTo(placement.post.z);
    expect(position.y).toBeCloseTo(sample(placement.post.x, placement.post.z));
    expect(post.rotation.y).toBeCloseTo(placement.rotation);
    const bounds = new Box3().setFromObject(post);
    expect(bounds.min.y).toBeLessThan(position.y);
    expect(bounds.max.y - position.y).toBeCloseTo(.935, 4);
  }
  markers.dispose();
});

it("keeps an unfinished sign rooted when construction preparation changes terrain", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  const frame = frameFor(17, 1, 0);
  let terrain = 2;
  const ground = { sample: () => terrain };
  const position = () => {
    marker.updateMatrixWorld(true);
    return marker.getObjectByName("building_road_signpost")!.getWorldPosition(new Vector3());
  };
  markers.update(marker, frame, ground);
  const before = position();
  terrain = 1.25;
  markers.update(marker, { ...frame, construction: .1 }, ground);
  const after = position();
  expect(after.x).toBe(before.x);
  expect(after.z).toBe(before.z);
  expect(after.y).toBeCloseTo(terrain);
  expect(marker.getObjectByName("building_road_signpost")!.visible).toBe(true);
  markers.dispose();
});

it("lights the painted sign tablet so it darkens with the wood at night", () => {
  const markers = createBuildingRoadMarkers(), marker = markers.create();
  markers.update(marker, frameFor());
  const icon = marker.getObjectByName("building_signpost_icon_front") as Mesh;
  expect(icon.material).toBeInstanceOf(MeshStandardMaterial);
  expect((icon.material as MeshStandardMaterial).emissive.getHex()).toBe(0);
  markers.dispose();
});

it("shares low-cost geometry and icon materials and disposes them once when the building layer closes", () => {
  const markers = createBuildingRoadMarkers(), first = markers.create(), second = markers.create();
  markers.update(first, frameFor()); markers.update(second, frameFor());
  const firstBoard = first.getObjectByName("building_road_signpost")!.children[1] as Mesh;
  const secondBoard = second.getObjectByName("building_road_signpost")!.children[1] as Mesh;
  const firstIcon = first.getObjectByName("building_signpost_icon_front") as Mesh;
  const secondIcon = second.getObjectByName("building_signpost_icon_front") as Mesh;
  expect(firstBoard.geometry).toBe(secondBoard.geometry);
  expect(firstIcon.material).toBe(secondIcon.material);
  const disposeGeometry = vi.spyOn(firstBoard.geometry, "dispose");
  const disposeMaterial = vi.spyOn(firstIcon.material as MeshStandardMaterial, "dispose");
  markers.dispose();
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(disposeMaterial).toHaveBeenCalledOnce();
});
