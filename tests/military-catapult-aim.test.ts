import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { CATAPULT_ENGINE_ORIGIN } from "../src/render-common/buildings/catapult-mechanism";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { prepareCatapultMesh, updateCatapultMesh } from "../src/renderers/three/buildings/catapult-building-pose";
import {
  CATAPULT_ANCHORS, CATAPULT_HOME_YAW, CATAPULT_PHASE_SECONDS, type CatapultCycle,
  catapultPose, rotateCatapultMechanismPoint, rotateCatapultPoint
} from "../src/shared/settlement/catapult-cycle";
import { CATAPULT, fireCatapultTowers } from "../src/shared/settlement/military-catapult";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = (dx: number, dz: number, rotation = 0) => {
  const building = { uid: 1, typeId: 16, x: 8, y: 0, z: 8, rotation, width: 2, depth: 2,
    construction: 1, input: { stone: 6 }, incoming: {} } as unknown as SettlementBuilding;
  const target = { uid: 3, x: 8 + dx, y: 0, z: 8 + dz, visible: true,
    phase: "militaryField" } as SettlementActor;
  const heavy = { actor: 2, rank: 0, building: 1, stationed: true,
    combat: { type: "heavy", faction: 0, hp: 100, cooldown: 0 } } as SettlementSoldier;
  const soldiers = new Map([[2, heavy], [3, { ...heavy, actor: 3, building: -3, stationed: false,
    combat: { ...heavy.combat!, faction: 1 } }]]);
  const context = { buildings: [building], options: { world: { cellsX: 20, cellsZ: 20,
    heights: new Float32Array(21 * 21) } } } as unknown as SettlementContext;
  const shots: Omit<MilitaryArrow, "id">[] = [];
  const launches: { aim: number; cycle: CatapultCycle }[] = [];
  const update = () => fireCatapultTowers(context, soldiers, [target], .05, shot => {
    shots.push(shot); launches.push({ aim: building.catapultAim ?? CATAPULT_HOME_YAW,
      cycle: { ...building.catapultCycle! } });
  });
  const advance = (seconds: number) => {
    for (let tick = 0; tick < Math.round(seconds * 20); tick++) update();
  };
  const until = (reached: () => boolean) => {
    for (let tick = 0; tick < 800 && !reached(); tick++) update();
    expect(reached()).toBe(true);
  };
  return { advance, building, launches, shots, target, until, update };
};
const difference = (first: number, second: number) => Math.atan2(Math.sin(first - second), Math.cos(first - second));

describe("Catapult manual traverse on a fixed roof", () => {
  it("joins the fire, return and idle arm poses continuously while keeping the stone through release", () => {
    const base = { operator: 2, target: 3, stoneSlot: 5 };
    const fireEnd = catapultPose({ ...base, phase: "fire", elapsed: CATAPULT_PHASE_SECONDS.fire });
    const returnStart = catapultPose({ ...base, phase: "return", elapsed: 0 });
    const returnEnd = catapultPose({ ...base, phase: "return", elapsed: CATAPULT_PHASE_SECONDS.return });
    expect(fireEnd.arm).toBeCloseTo(returnStart.arm, 10);
    expect(returnEnd.arm).toBeCloseTo(catapultPose().arm, 10);
    expect(fireEnd.loaded).toBe(true);
    expect(returnStart.loaded).toBe(false);
  });
  it("releases along the visible arm stroke instead of the opposite direction", () => {
    const [x, y, z] = CATAPULT_ANCHORS.release, pivot = CATAPULT_ANCHORS.pivot;
    const beforeRelease = [x, pivot[1] + (y - pivot[1]) * Math.cos(.001) - (z - pivot[2]) * Math.sin(.001),
      pivot[2] + (y - pivot[1]) * Math.sin(.001) + (z - pivot[2]) * Math.cos(.001)];
    const stroke = Math.atan2(x - beforeRelease[0]!, z - beforeRelease[2]!);
    const state = fixture(4, 0); state.until(() => state.shots.length === 1);
    const shot = state.shots[0]!;
    expect(difference(stroke + state.launches[0]!.aim, Math.atan2(shot.vx, shot.vz))).toBeCloseTo(0, 7);
  });
  it("faces every cardinal direction at each building rotation and releases from that same cup", () => {
    const scale = getRomanBuildingWorldSizing(getBuildingDefinition(16)).scale;
    for (const rotation of [0, 1, 2, 3]) for (const [dx, dz] of [[4, 0], [0, 4], [-4, 0], [0, -4]]) {
      const state = fixture(dx!, dz!, rotation); state.until(() => state.shots.length === 1);
      const shot = state.shots[0]!, baseYaw = rotation * Math.PI / 2, aim = state.launches[0]!.aim;
      const origin = rotateCatapultPoint(CATAPULT_ENGINE_ORIGIN, baseYaw);
      const bearing = Math.atan2(state.target.x - state.building.x - origin[0] * scale,
        state.target.z - state.building.z - origin[2] * scale);
      const cup = rotateCatapultPoint(rotateCatapultMechanismPoint(CATAPULT_ANCHORS.release, aim), baseYaw);
      expect(state.shots).toHaveLength(1);
      expect(difference(baseYaw + aim, bearing + Math.PI)).toBeCloseTo(0, 7);
      expect(shot.x).toBeCloseTo(state.building.x + cup[0] * scale, 7);
      expect(shot.y).toBeCloseTo(state.building.y + cup[1] * scale, 7);
      expect(shot.z).toBeCloseTo(state.building.z + cup[2] * scale, 7);
      expect(difference(Math.atan2(shot.vx, shot.vz), bearing)).toBeCloseTo(0, 7);
    }
  });
  it("tracks during manual traverse, captures the target at launch, then returns the launcher home", () => {
    const state = fixture(4, 0); state.advance(2);
    state.target.x = 5; state.target.z = 11;
    state.until(() => state.building.catapultCycle?.phase === "traverse");
    state.advance(.15); state.target.x = 11; state.target.z = 5;
    state.until(() => state.shots.length === 1);
    const shot = state.shots[0]!, angle = state.building.catapultAim;
    expect(shot.boulder).toMatchObject({ target: 3, x: 11, z: 5 });
    state.target.x = 4; state.target.z = 4; state.advance(.3);
    expect(state.building.catapultAim).toBe(angle);
    expect(shot.boulder).toMatchObject({ x: 11, z: 5 });
    state.until(() => !state.building.catapultCycle);
    expect(difference(state.building.catapultAim!, CATAPULT_HOME_YAW)).toBeCloseTo(0, 2);
  });
  it("omits the former well-style crank animation from current preparation", () => {
    const state = fixture(4, 0), phases = new Set<string>();
    for (let tick = 0; tick < 800 && !state.shots.length; tick++) {
      state.update(); const phase = state.building.catapultCycle?.phase;
      if (phase) phases.add(phase);
      expect(catapultPose(state.building.catapultCycle).hands).not.toBe("crank");
    }
    expect(state.shots).toHaveLength(1); expect(phases.has("load")).toBe(true);
    expect(phases.has("traverse")).toBe(true); expect(phases.has("wind")).toBe(false);
  });

  it("turns only tagged engine joints around the offset bearing, leaving the deck and rack fixed", () => {
    const cycle = { operator: 2, target: 3, phase: "fire" as const, elapsed: .1, stoneSlot: 5 };
    for (const kind of ["frame", "arm", "loaded", "crank"] as const) {
      const geometry = new BoxGeometry(.1, .1, .1); geometry.translate(.3, 2.5, .4);
      const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
      prepareCatapultMesh(mesh, kind); updateCatapultMesh(mesh, cycle, 0, 1); mesh.updateMatrixWorld(true);
      const point = mesh.localToWorld(new Vector3().fromBufferAttribute(geometry.getAttribute("position"), 0));
      updateCatapultMesh(mesh, cycle, Math.PI / 2, 1); mesh.updateMatrixWorld(true);
      const turned = mesh.localToWorld(new Vector3().fromBufferAttribute(geometry.getAttribute("position"), 0));
      const expected = [CATAPULT_ENGINE_ORIGIN[0] + point.z - CATAPULT_ENGINE_ORIGIN[2], point.y,
        CATAPULT_ENGINE_ORIGIN[2] - point.x + CATAPULT_ENGINE_ORIGIN[0]];
      turned.toArray().forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 6));
      geometry.dispose(); material.dispose();
    }
    const recipe = createCatapultTowerRecipe("roman", true);
    expect(recipe.parts.filter(part => part.stock?.ware === "stone")).toHaveLength(2);
    expect(recipe.parts.filter(part => part.stock?.ware === "stone").every(part => !part.catapultPart)).toBe(true);
    expect(recipe.parts.filter(part => part.position[1] === 1.69).every(part => !part.catapultPart)).toBe(true);
  });

  it("holds the bearing during fixed stock handling and turns only once hands are on the traverse bar", () => {
    const state = fixture(4, 0);
    for (let tick = 0; tick < 800; tick++) {
      state.update();
      const phase = state.building.catapultCycle?.phase;
      if (phase === "traverse") break;
      expect(state.building.catapultAim ?? CATAPULT_HOME_YAW).toBe(CATAPULT_HOME_YAW);
      expect(state.shots).toHaveLength(0);
    }
    expect(state.building.catapultCycle?.phase).toBe("traverse");
    const before = state.building.catapultAim ?? CATAPULT_HOME_YAW; state.update();
    expect(Math.abs(difference(state.building.catapultAim!, before))).toBeGreaterThan(0);
    expect(Math.abs(difference(state.building.catapultAim!, before))).toBeLessThanOrEqual(CATAPULT.aimSpeed * .05 + 1e-9);
    expect(catapultPose(state.building.catapultCycle).hands).toBe("bar");
  });

  it("finishes and parks an existing shot, then yields the roof until the real porter clears it", () => {
    const state = fixture(4, 0); state.building.input.stone = 5;
    state.until(() => state.building.catapultCycle?.phase === "clear");
    state.building.catapultSupply = { ground: 0,
      porter: { actor: 4, carrying: true, phase: "stairs-up", elapsed: 0 } };
    state.until(() => state.shots.length === 1);
    state.until(() => !state.building.catapultCycle);
    state.advance(30);
    expect(state.shots).toHaveLength(1); expect(state.building.input.stone).toBe(4);
    expect(difference(state.building.catapultAim!, CATAPULT_HOME_YAW)).toBeCloseTo(0, 2);
    // The porter has physically placed its one stone and descended past the hatch.
    state.building.input.stone = (state.building.input.stone ?? 0) + 1;
    delete state.building.catapultSupply.porter;
    state.until(() => state.shots.length === 2);
    expect(state.building.input.stone).toBe(4);
  });
});
