import { expect, it, vi } from "vitest";

import { recordedCommandProblem } from "../../island-of-settlers-shared/src/commands/command-rules";
import { isRoadDecorationAction } from "../../island-of-settlers-shared/src/road-decoration-custody";
import type { RoadDecorationPlacementContext } from "../src/shared/settlement/road-decoration-placement";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";

const item = "roadDecoration:roman-rusticated-arch:limestone";
const order = { item, position: { x: 5, z: 4.25 }, yaw: 0 } as const;
const context = (): RoadDecorationPlacementContext => ({ nation: "roman", roads: [],
  heightAt: () => 0, isOwned: () => true, isFree: () => true });

it("four quarter turns preserve identity, position, inventory and save state without self-collision", () => {
  const consume = vi.fn(() => true), receive = vi.fn(() => true), owner = createRoadDecorationState(context);
  expect(owner.place(order, consume)).toEqual({ ok: true, uid: 1 });
  const before = owner.save();
  for (let turn = 1; turn <= 4; turn++) {
    expect(owner.rotate(1)).toEqual({ ok: true, uid: 1, item });
    expect(owner.frames()[0]!.yaw).toBe((turn * Math.PI / 2) % (Math.PI * 2));
    expect(owner.frames()[0]!.position).toEqual([5, 0, 4.25]);
  }
  expect(owner.save()).toEqual(before);
  expect(owner.claimReturns([], receive)).toEqual({ ok: true, returned: 0 });
  expect(consume).toHaveBeenCalledOnce(); expect(receive).not.toHaveBeenCalled();
  const restored = createRoadDecorationState(context); restored.load(owner.save());
  expect(restored.save()).toEqual(before);
});

it("a refused rotation keeps every saved field and spatial entry unchanged", () => {
  const environment = context();
  environment.roads = Array.from({ length: 12 }, (_, index) => ({
    start: { x: 5, z: 1 + index * .5 }, end: { x: 5, z: 1.5 + index * .5 }, tier: "stone"
  }));
  const owner = createRoadDecorationState(() => environment);
  expect(owner.place(order, () => true).ok).toBe(true);
  const before = owner.save(), frame = owner.frames()[0];
  expect(owner.rotate(1)).toEqual({ ok: false, reason: "road-traffic-obstructed" });
  expect(owner.save()).toEqual(before); expect(owner.frames()[0]).toBe(frame);
  expect(owner.rotate(999)).toEqual({ ok: false, reason: "decoration-not-placed" });
});

it("atomic relocation ignores itself but rejects another owned decoration and preserves the return outbox", () => {
  const owner = createRoadDecorationState(context), consume = vi.fn(() => true);
  expect(owner.place(order, consume).ok).toBe(true);
  expect(owner.place({ ...order, position: { x: 10, z: 10 } }, consume).ok).toBe(true);
  const before = owner.save();
  expect(owner.move(1, { x: 10, z: 10 }, 0)).toEqual({ ok: false, reason: "decoration-obstructed" });
  expect(owner.save()).toEqual(before);
  expect(owner.move(1, { x: 15, z: 14 }, Math.PI / 4)).toEqual({ ok: true, uid: 1, item });
  expect(owner.save()).toMatchObject({ nextUid: 3, nextReturn: 1, returns: [],
    placed: [{ uid: 1, item, position: { x: 15, z: 14 }, yaw: Math.PI / 4 }, before.placed[1]] });
  expect(consume).toHaveBeenCalledTimes(2);
  const restored = createRoadDecorationState(context); restored.load(owner.save());
  expect(restored.save()).toEqual(owner.save());
  expect(restored.framesNear({ min: [4, 0, 3], max: [6, 3, 5] })).toEqual([]);
  expect(restored.framesNear({ min: [14, 0, 13], max: [16, 3, 15] }).map(frame => frame.uid)).toEqual([1]);
});

it("private and replay transform contracts reject forged items, extra fields and nonfinite poses", () => {
  expect(isRoadDecorationAction({ kind: "rotate", uid: 1 })).toBe(true);
  expect(isRoadDecorationAction({ kind: "move", uid: 1, position: { x: 5, z: 6 }, yaw: 1 })).toBe(true);
  for (const action of [{ kind: "rotate", uid: 0 }, { kind: "rotate", uid: 1, item },
    { kind: "move", uid: 1, position: { x: NaN, z: 6 }, yaw: 1 },
    { kind: "move", uid: 1, position: { x: 5, z: 6 }, yaw: Infinity }])
    expect(isRoadDecorationAction(action)).toBe(false);
  const accepted = (name: string, args: unknown[]) => recordedCommandProblem({ args, name }, true) === null;
  expect(accepted("rotateRoadDecoration", [1])).toBe(true);
  expect(accepted("rotateRoadDecoration", [1, item])).toBe(false);
  expect(accepted("moveRoadDecoration", [1, { x: 5, z: 6 }, 1])).toBe(true);
  expect(accepted("moveRoadDecoration", [1, { x: 5, z: 6 }])).toBe(false);
});
