import { expect, it, vi } from "vitest";

import { createCommanderEscort } from "../src/shared/settlement/military-direct-escort";
import type { MilitaryDirectSave } from "../src/shared/settlement/military-direct-state";
import type { CombatCore } from "../src/shared/settlement/settlement-combat-core";

const state = (): MilitaryDirectSave => ({
  escort: { anchor: { x: 0, z: 0 }, remaining: 0 },
  follow: { archer: true, heavy: true, shield: true },
  roster: Array.from({ length: 20 }, (_, index) => index + 1)
} as MilitaryDirectSave);

const fakeCore = () => {
  const actors = new Map(Array.from({ length: 20 }, (_, index) => {
    const uid = index + 1;
    return [uid, { path: [{ x: 80, z: 0 }], phase: "militaryField", uid, visible: true }];
  }));
  actors.set(0, { path: [], phase: "militaryField", uid: 0, visible: true,
    x: 100, y: 0, yaw: -Math.PI / 2, z: 0 } as never);
  const commander = { actor: 0, combat: { hp: 5 } };
  return {
    actors,
    actorById: (uid: number) => actors.get(uid),
    context: { commander: { soldier: () => commander } },
    pendingMarches: new Map(),
    sieges: { atDoor: () => false },
    soldiers: new Map(Array.from({ length: 20 }, (_, index) => {
      const uid = index + 1;
      return [uid, { actor: uid, combat: { type: "shield" } }];
    }))
  } as unknown as CombatCore & { actors: Map<number, { path: { x: number; z: number }[] }> };
};

it("replans only eight stale followers per update and keeps the anchor until the rest follow", () => {
  const saved = state(), core = fakeCore();
  const march = vi.fn((ids: number[]) => {
    for (const id of ids) core.actors.get(id)!.path = [{ x: 102, z: 0 }];
  });
  const escort = createCommanderEscort(core, () => saved, march as never);
  escort.update(.5);
  expect(march).toHaveBeenCalledTimes(1);
  expect((march.mock.calls[0]![0] as number[])).toHaveLength(8);
  expect(saved.escort.anchor).toEqual({ x: 0, z: 0 });
  escort.update(.5);
  expect((march.mock.calls[1]![0] as number[])).toHaveLength(8);
  escort.update(.5);
  expect((march.mock.calls[2]![0] as number[])).toHaveLength(4);
  expect(saved.escort.anchor).not.toEqual({ x: 0, z: 0 });
});

it("keeps walking followers out of the replan set", () => {
  const saved = state(), core = fakeCore(), march = vi.fn();
  const walking = core.actorById(1)!;
  walking.path = [{ x: 102, z: 0 }];
  const escort = createCommanderEscort(core, () => saved, march as never);
  escort.update(.5);
  expect(march.mock.calls[0]![0]).not.toContain(1);
});
