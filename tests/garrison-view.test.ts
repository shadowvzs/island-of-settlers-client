import { describe, expect, it } from "vitest";

import { garrisonViewActors } from "../src/app/settlement/garrison-view";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { garrisonSlots } from "../src/render-common/buildings/military-garrison-slots";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";
import { GARRISON_CAPACITIES } from "../src/shared/balance/military";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";

const building = (typeId: number, uid: number, rotation = 0) =>
  ({ construction: 1, depth: 4, rotation, typeId, uid, width: 3, x: 10, y: 1, z: 20 }) as SettlementBuilding;
const actor = (uid: number) => ({ action: "idle", job: "Soldier", path: [], phase: "garrison", uid, visible: false,
  x: 0, y: 0, z: 0, yaw: 0 }) as unknown as SettlementActor;
const soldier = (actorId: number, buildingId: number, type: string) =>
  ({ actor: actorId, building: buildingId, combat: { faction: 0, type }, stationed: true });

describe("garrison view", () => {
  it("retains full visible posts in the original four military layouts", () => {
    for (const [type, capacity] of Object.entries(GARRISON_CAPACITIES).filter(([type]) => Number(type) !== 16))
      for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
        expect(garrisonSlots(Number(type), nation).length).toBeGreaterThanOrEqual(capacity);
  });

  it("reserves one exposed catapult crew slot while porters use their actual ground work positions", () => {
    for (const nation of ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const)
      expect(garrisonSlots(16, nation).map(slot => slot.kind)).toEqual(["crew"]);
  });

  it("finds archer posts and real windows, but no arrow slits", () => {
    expect(garrisonSlots(4).map(slot => slot.kind))
      .toEqual(["archer", "archer", "archer", "window", "window", "window", "window"]);
    expect(garrisonSlots(2).map(slot => slot.kind)).toEqual(["archer", "archer", "window", "window"]);
    expect(garrisonSlots(1).map(slot => slot.kind)).toEqual(["window", "window"]);
    // Fortress: 6 posts (corner towers and keep) and 8 look-out windows; its arrow slits stay too narrow.
    expect(garrisonSlots(9).filter(slot => slot.kind === "archer")).toHaveLength(6);
    expect(garrisonSlots(9).filter(slot => slot.kind === "window")).toHaveLength(8);
  });

  it("leans window soldiers out past each nation's wall, on High and Minimal", () => {
    const window = garrisonSlots(1, "nubian")[1]!;
    const { scale } = getRomanBuildingWorldSizing(getBuildingDefinition(1));
    const head = window.position[0] + WORKER_HEIGHT * .88 * Math.sin(window.lean);
    // The Nubian plaster jambs reach .95 (recipe units) out: the head is seen in front of them.
    expect(window.lean).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(.95 * scale);
    // Military halls and the watchtower keep their window panels on Minimal.
    for (const type of [1, 2, 4]) expect(garrisonSlots(type, "roman", false).map(slot => slot.kind))
      .toEqual(garrisonSlots(type, "roman", true).map(slot => slot.kind));
  });

  it("puts archers on their posts first and everyone else in the windows; the rest stay inside", () => {
    const soldiers = [soldier(1, 7, "shield"), soldier(2, 7, "archer"), soldier(3, 7, "heavy"), soldier(4, 7, "archer"),
      soldier(5, 7, "shield")];
    const views = garrisonViewActors([building(2, 7)], soldiers, [1, 2, 3, 4, 5].map(actor));
    expect(views.map(view => view.uid)).toEqual([2, 4, 1, 3]);
    expect(views.every(view => view.visible && view.phase === "garrisonView")).toBe(true);
    expect(views[0]!.y).toBeGreaterThan(2);
  });

  it("asks a per-building recipe predicate like the global answer (R16b possessed view)", () => {
    const garrison = [soldier(1, 7, "shield"), soldier(2, 8, "shield")];
    const both = [building(1, 7), building(1, 8)];
    const asked: number[] = [];
    const mixed = garrisonViewActors(both, garrison, [actor(1), actor(2)], "nubian", target => {
      asked.push(target.uid);
      return target.uid === 7;
    });
    const detailed = garrisonViewActors([both[0]!], [garrison[0]!], [actor(1)], "nubian", true);
    const simple = garrisonViewActors([both[1]!], [garrison[1]!], [actor(2)], "nubian", false);
    expect(asked).toEqual([7, 8]);
    expect(mixed).toEqual([...detailed, ...simple]);
  });

  it("follows the building's quarter turn and ignores sites under construction", () => {
    const [plain] = garrisonViewActors([building(4, 7)], [soldier(1, 7, "archer")], [actor(1)]);
    const [turned] = garrisonViewActors([building(4, 7, 1)], [soldier(1, 7, "archer")], [actor(1)]);
    expect(turned!.x - 10).toBeCloseTo(plain!.z - 20);
    expect(turned!.yaw - plain!.yaw).toBeCloseTo(Math.PI / 2);
    expect(garrisonViewActors([{ ...building(4, 7), construction: .5 }], [soldier(1, 7, "archer")], [actor(1)])).toEqual([]);
  });

  it("turns tower archers toward the nearest enemy in bow range", () => {
    const enemy = { ...actor(9), phase: "militaryField", x: 10, z: 25 } as SettlementActor;
    const enemySoldier = { actor: 9, building: -3, combat: { faction: 1, type: "shield" }, stationed: false };
    const [archer] = garrisonViewActors([building(4, 7)], [soldier(1, 7, "archer"), enemySoldier], [actor(1), enemy]);
    expect(Math.cos(archer!.yaw)).toBeGreaterThan(.9);
  });

  it("does not turn tower archers towards enemies under the walls they cannot shoot", () => {
    const under = { ...actor(9), phase: "militaryField", x: 10, z: 23 } as SettlementActor;
    const enemySoldier = { actor: 9, building: -3, combat: { faction: 1, type: "shield" }, stationed: false };
    const [archer] = garrisonViewActors([building(4, 7)], [soldier(1, 7, "archer"), enemySoldier], [actor(1), under]);
    const [alone] = garrisonViewActors([building(4, 7)], [soldier(1, 7, "archer")], [actor(1)]);
    expect(archer!.yaw).toBeCloseTo(alone!.yaw);
  });
});
