import { expect, it } from "vitest";

import { isRoadDecorationAction } from "../../island-of-settlers-shared/src/road-decoration-custody";
import { roadDecorationSaveProblem } from "../src/shared/settlement/road-decoration-save";

const item = "roadDecoration:indigenous-flower-pot:native";
const order = { item, position: { x: 8.75, z: 11.5 }, yaw: Math.PI / 4 };

it("private actions accept exact absolute position/yaw and reject stale road attachment, extra fields and nonfinite input", () => {
  expect(isRoadDecorationAction({ kind: "place", order })).toBe(true);
  for (const change of [{ yaw: Number.NaN }, { yaw: Infinity }, { position: { x: -1, z: 1 } },
    { position: { x: 16385, z: 1 } }, { position: { x: 1, z: 1, y: 8 } }, { side: 1 }, { edge: {} }])
    expect(isRoadDecorationAction({ kind: "place", order: { ...order, ...change } })).toBe(false);
  expect(isRoadDecorationAction({ kind: "place", order: { item, anchor: { x: 1, z: 1 }, side: 1,
    edge: { start: { x: 1, z: 0 }, end: { x: 1, z: 2 } } } })).toBe(false);
});

it("save identity contains only absolute placement and monotone UID; old road-dependent saves are intentionally unsupported", () => {
  const saved = { nextUid: 2, nextReturn: 1, placed: [{ uid: 1, ...order }], returns: [] };
  expect(roadDecorationSaveProblem(saved)).toBeNull();
  expect(roadDecorationSaveProblem({ ...saved, placed: [{ ...saved.placed[0], edge: {} }] })).not.toBeNull();
  expect(roadDecorationSaveProblem({ ...saved, placed: [{ ...saved.placed[0], position: { x: Infinity, z: 0 } }] })).not.toBeNull();
});
