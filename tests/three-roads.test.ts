import { DirectionalLight, Mesh, type MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { computeEnvironment, getSunVector } from "../src/render-common/environment";
import { createRoadGeometry } from "../src/renderers/three/settlement/road-geometry";
import { createRoadMaterial } from "../src/renderers/three/settlement/road-materials";
import { createRoadSurfaceProfile } from "../src/renderers/three/settlement/road-surface-profile";
import { createThreeRoads } from "../src/renderers/three/settlement/three-roads";
import { ROAD_WIDTH, type RoadSegment, type RoadWorld } from "../src/shared/settlement/road-types";

const world: RoadWorld = {
  cellsX: 8,
  cellsZ: 8,
  heights: new Float32Array(81),
  blocking: new Uint8Array(64)
};
const segments: RoadSegment[] = [
  { start: { x: 1, z: 1 }, end: { x: 1.5, z: 1 }, tier: "dirt" },
  { start: { x: 1.5, z: 1 }, end: { x: 2, z: 1 }, tier: "stone" }
];

it.each([true, false])("adds a low ground-following dirt crown with no extra triangles (%s)", detailed => {
  const route: RoadSegment[] = [{ start: { x: 1, z: 1 }, end: { x: 5, z: 1 }, tier: "dirt" }];
  const height = (x: number, z: number) => .12 * x + .07 * z;
  const dirt = createRoadGeometry(route, "dirt", detailed, height);
  const stone = createRoadGeometry(route.map(segment => ({ ...segment, tier: "stone" })), "stone", detailed, height);
  expect(dirt.index!.count).toBe(stone.index!.count);
  const positions = dirt.getAttribute("position");
  const lift = Array.from({ length: positions.count }, (_, index) =>
    positions.getY(index) - height(positions.getX(index), positions.getZ(index)));
  expect(Math.max(...lift)).toBeGreaterThan(.038);
  expect(Math.max(...lift)).toBeLessThanOrEqual(.046001);
  expect(Math.min(...lift)).toBeCloseTo(.018, 6);
  dirt.dispose(); stone.dispose();
});

it("uses the same world-space crown at crossing ribbons and tapered doorways", () => {
  const profile = createRoadSurfaceProfile([
    [{ point: { x: -2, z: 0 } }, { point: { x: 2, z: 0 } }],
    [{ point: { x: 0, z: -2 } }, { point: { x: 0, z: 2 }, width: .34 }]
  ]);
  expect(profile(0, 0)).toBeCloseTo(.028, 6);
  expect(profile(1, .5)).toBe(0); // Stale since 041bde88c: owner Nov 3 widened dirt roads 0.8 -> 0.9 (half width 0.45); doors stay 0.34.
  expect(profile(.17, 2)).toBe(0);
  expect(profile(.1, 2)).toBeGreaterThan(.02);
});

it("adds paved cart grooves only to detailed roads with traffic wear", () => {
  const detailed = createRoadMaterial("limestone", true, { uTrafficWear: { value: null } });
  expect(detailed.userData.shaderKey).toBe("paved-road-grooves-v1");
  const minimal = createRoadMaterial("limestone", false);
  expect(minimal.userData.shaderKey).toBeUndefined();
});

it.each(["high", "minimal"] as const)(
  "renders original %s roads above actual terrain in two surface batches plus cached edge stones",
  (quality) => {
    const height = (x: number, z: number) => x * 0.1 + z * 0.2;
    const layer = createThreeRoads(world, quality, height);
    layer.update(segments);
    const meshes: Mesh[] = [];
    layer.root.traverse((child) => {
      if (child instanceof Mesh && ["dirt_roads","stone_roads"].includes(child.name)) meshes.push(child);
    });
    expect(meshes).toHaveLength(2);
    for (const child of meshes) {
      expect(child).toBeInstanceOf(Mesh);
      const mesh = child as Mesh;
      const positions = mesh.geometry.getAttribute("position"),
        normals = mesh.geometry.getAttribute("normal");
      for (let i = 0; i < positions.count; i++) {
        const offset = positions.getY(i) - height(positions.getX(i), positions.getZ(i));
        expect(offset).toBeGreaterThan(0.009);
        expect(offset).toBeLessThan(0.05);
        expect(normals.getY(i)).toBeGreaterThan(0);
      }
      const material = mesh.material as MeshStandardMaterial;
      expect(material.map).toBeDefined();
      expect(Boolean(material.bumpMap)).toBe(quality === "high");
      // Feathering adds one edge ring; both tiers remain small, fixed batches.
      expect(mesh.geometry.index!.count).toBeLessThan(300);
      const colors = mesh.geometry.getAttribute("color");
      expect(colors.itemSize).toBe(4);
      expect(Array.from({ length: colors.count }, (_, index) => colors.getW(index))).toContain(0);
      expect(material.transparent).toBe(true);
    }
    const old = meshes[0]!;
    let disposed = false;
    old.geometry.addEventListener("dispose", () => {
      disposed = true;
    });
    layer.update([]);
    expect(disposed).toBe(true);
    expect(layer.root.getObjectByName("dirt_roads")).toBeUndefined();
    expect(layer.root.getObjectByName("stone_roads")).toBeUndefined();
    layer.dispose();
  }
);

it.each([true, false])("curves degree-two bends without a circular patch, detailed=%s", (detailed) => {
  const segments: RoadSegment[] = [
    { start: { x: 0, z: 0 }, end: { x: 1, z: 0 }, tier: "dirt" },
    { start: { x: 1, z: 0 }, end: { x: 1, z: 1 }, tier: "dirt" }
  ];
  const geometry = createRoadGeometry(segments, "dirt", detailed, () => 0);
  const positions = geometry.getAttribute("position"), colors = geometry.getAttribute("color");
  const centres = Array.from({ length: positions.count }, (_, index) => ({
    x: positions.getX(index), z: positions.getZ(index), alpha: colors.getW(index)
  }));
  // Sampled arc cuts the bend rather than retaining the old (1,0) disc centre.
  expect(centres.some(({ x, z }) => Math.abs(x - 1) < 0.00001 && Math.abs(z) < 0.00001)).toBe(false);
  // Half width is 0.45 since 041bde88c (dirt 0.9), so the arc starts at x = 0.55.
  expect(centres.some(({ alpha, x, z }) => x > 0.54 && x < 0.98 && z > 0.05 && z < 0.35 && alpha === 1)).toBe(true);
  const normals = geometry.getAttribute("normal");
  for (let vertex = 0; vertex < positions.count; vertex++) expect(normals.getY(vertex)).toBeGreaterThan(0);
  expect(geometry.index!.count).toBeLessThan(detailed ? 900 : 400);
  geometry.dispose();
});

it.each([true, false])("ends the doorway strip exactly at its threshold, detailed=%s", (detailed) => {
  const segments: RoadSegment[] = [
    { start: { x: 0, z: 0 }, end: { x: 0, z: 1 }, tier: "dirt", doorway: true }
  ];
  const geometry = createRoadGeometry(segments, "dirt", detailed, () => 0);
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.max.z).toBeCloseTo(1, 7);
  expect(geometry.boundingBox!.min.z).toBeLessThan(0); // Ordinary outside end retains its round cap.
  geometry.dispose();
});

it("retains terrain-conforming three-way junctions and never creates per-segment meshes", () => {
  const segments: RoadSegment[] = [
    { start: { x: 0, z: 0 }, end: { x: 1, z: 0 }, tier: "stone" },
    { start: { x: 0, z: 0 }, end: { x: -1, z: 0 }, tier: "stone" },
    { start: { x: 0, z: 0 }, end: { x: 0, z: 1 }, tier: "stone" }
  ];
  const layer = createThreeRoads(world, "high", (x, z) => x * 0.02 + z * 0.03);
  layer.update(segments);
  const surface = layer.root.getObjectByName("stone_roads") as Mesh;
  expect(surface).toBeDefined();
  expect(surface.geometry.getAttribute("position").count).toBeLessThan(250);
  expect((surface.material as MeshStandardMaterial).bumpScale).toBeGreaterThan(0.04);
  layer.dispose();
});

it.each([true, false])("widens passing roads and tapers at the door without crossing a foundation corner, detailed=%s", (detailed) => {
  const segments: RoadSegment[] = [
    ...Array.from({ length: 8 }, (_, index) => ({
      start: { x: 4 + index * .5, z: 4 }, end: { x: 4.5 + index * .5, z: 4 }, tier: "dirt" as const
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      start: { x: 8, z: 4 + index * .5 }, end: { x: 8, z: 4.5 + index * .5 }, tier: "dirt" as const
    })),
    { start: { x: 8, z: 8 }, end: { x: 8, z: 9 }, tier: "dirt", doorway: true }
  ];
  const geometry = createRoadGeometry(segments, "dirt", detailed, () => 0);
  const positions = geometry.getAttribute("position");
  const ends: number[] = [];
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), z = positions.getZ(index);
    if (Math.abs(z - 9) < 1e-6) ends.push(x);
    if (x > 7.2 && x < 8 && z > 4 && z < 4.8)
      expect(Math.min(8 - x, z - 4)).toBeLessThanOrEqual(.462);
  }
  expect(Math.max(...ends) - Math.min(...ends)).toBeGreaterThan(.32);
  expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(.365);
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.max.z).toBeCloseTo(9, 6);
  geometry.dispose();
});

it.each(["high", "minimal"] as const)("previews the same width and rounded diagonal road geometry at %s", quality => {
  const planned: RoadSegment[] = [
    { start: { x: 1, z: 1 }, end: { x: 3, z: 1 }, tier: "dirt", preview: true },
    { start: { x: 3, z: 1 }, end: { x: 3, z: 4 }, tier: "dirt", preview: true }
  ];
  const layer = createThreeRoads(world, quality, () => 0);
  const preview = { start: planned[0]!.start, end: planned[1]!.end,
    points: [planned[0]!.start, planned[0]!.end, planned[1]!.end],
    segments: planned, contextSegments: planned, valid: true };
  layer.updatePreview(preview);
  const mesh = layer.root.getObjectByName("dirt_road_preview") as Mesh;
  expect(mesh).toBeDefined();
  const actual = createRoadGeometry(planned.map(segment => ({ ...segment, preview: undefined })),
    "dirt", quality === "high", () => 0);
  const positions = mesh.geometry.getAttribute("position"), built = actual.getAttribute("position");
  expect(positions.count).toBe(built.count);
  for (let index = 0; index < positions.count; index++) {
    expect(positions.getX(index)).toBe(built.getX(index));
    expect(positions.getZ(index)).toBe(built.getZ(index));
    expect(positions.getY(index) - built.getY(index)).toBeCloseTo(.045);
  }
  let disposed = false;
  mesh.geometry.addEventListener("dispose", () => { disposed = true; });
  layer.updatePreview(preview);
  expect(disposed).toBe(false);
  layer.updatePreview({ ...preview, valid: false, segments: [] });
  expect(disposed).toBe(true);
  expect(layer.root.getObjectByName("dirt_road_preview")).toBeUndefined();
  actual.dispose(); layer.dispose();
});

it.each([true,false])('keeps junction, bend and overlapping ribbon texture/height continuous in world coordinates (%s)',detailed=>{
 const roads:RoadSegment[]=[
  {start:{x:2,z:2},end:{x:5,z:2},tier:'dirt'},
  {start:{x:2,z:2},end:{x:2,z:5},tier:'dirt'},
  {start:{x:2,z:2},end:{x:1,z:1},tier:'dirt'},
  {start:{x:1,z:2.45},end:{x:5,z:2.45},tier:'dirt'}];
 const height=(x:number,z:number)=>.1*x+.2*z;
 const geometry=createRoadGeometry(roads,'dirt',detailed,height),positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),colors=geometry.getAttribute('color');
 for(let i=0;i<positions.count;i++){
  expect(uv.getX(i)).toBeCloseTo(positions.getX(i),6);expect(uv.getY(i)).toBeCloseTo(positions.getZ(i),6);
  const lift=positions.getY(i)-height(positions.getX(i),positions.getZ(i));
  expect(lift).toBeGreaterThanOrEqual(.017999);expect(lift).toBeLessThanOrEqual(.046001);
  expect(colors.getX(i)).toBe(1);expect(colors.getY(i)).toBe(1);expect(colors.getZ(i)).toBe(1);
 }geometry.dispose();
});


it.each([6, 12, 18, 23])("places the road sun on the canonical shadow vector at hour %s", hour => {
  const layer = createThreeRoads(world, "high", () => 0);
  const environment = computeEnvironment({ azimuthX: .8, azimuthZ: .35, elevation: .8 }, hour, 0);
  layer.updateEnvironment(environment);
  const sun = layer.root.children.find((child): child is DirectionalLight => child instanceof DirectionalLight);
  expect(sun).toBeDefined();
  const offset = sun!.position.clone().sub(sun!.target.position).normalize();
  const expected = getSunVector(environment.sun);
  expect(offset.x).toBeCloseTo(expected[0], 6);
  expect(offset.y).toBeCloseTo(expected[1], 6);
  expect(offset.z).toBeCloseTo(expected[2], 6);
  layer.dispose();
});

it("adds narrow exposed side shoulders and suppresses a covered interior rim even when the other centre is farther", () => {
  const half = ROAD_WIDTH / 2, edge = half * .84;
  const line = (z: number) => [{ point: { x: -3, z } }, { point: { x: 3, z } }];
  const alone = createRoadSurfaceProfile([line(0)]), overlap = createRoadSurfaceProfile([line(0), line(ROAD_WIDTH * .92)]);
  const crown = .028 * (1 - .84 ** 4) - .003 * Math.exp(-(((.84 - .55) / .16) ** 2));
  expect(alone(0, edge)).toBeCloseTo(crown + .013, 6);
  expect(overlap(0, edge)).toBeCloseTo(crown, 6);
  expect(overlap(0, -edge)).toBeCloseTo(alone(0, -edge), 6);
  expect(alone(0, half)).toBe(0);
  expect(alone(0, 0)).toBeCloseTo(.028, 5);
  // Shoulders are longitudinal: the rounded terminal surface has no transverse raised rim.
  expect(alone(3 + edge, 0)).toBeCloseTo(crown, 6);
});

it.each([true, false])("shares mixed-tier junction elevations and keeps shoulder geometry in one batch per tier (%s)", detailed => {
  const segments: RoadSegment[] = [
    { start: { x: 0, z: 0 }, end: { x: 3, z: 0 }, tier: "dirt" },
    { start: { x: 0, z: 0 }, end: { x: 0, z: 3 }, tier: "stone" },
  ];
  const dirt = createRoadGeometry(segments, "dirt", detailed, () => 0), stone = createRoadGeometry(segments, "stone", detailed, () => 0);
  const map = (geometry: typeof dirt) => {
    const positions = geometry.getAttribute("position"), points = new Map<string, number>();
    for (let index = 0; index < positions.count; index++) points.set(`${positions.getX(index).toFixed(6)}:${positions.getZ(index).toFixed(6)}`, positions.getY(index));
    return points;
  };
  const a = map(dirt), b = map(stone); let shared = 0;
  for (const [point, y] of a) if (b.has(point)) { expect(y).toBeCloseTo(b.get(point)!, 6); shared++; }
  // The 0.8 dirt cap sits inside the 1.2 stone cap: they share the junction centre and its crown.
  expect(shared).toBeGreaterThan(0);
  expect(a.get("0.000000:0.000000")).toBeCloseTo(b.get("0.000000:0.000000")!, 6);
  expect(dirt.groups).toHaveLength(0); expect(stone.groups).toHaveLength(0);
  dirt.dispose(); stone.dispose();
});
