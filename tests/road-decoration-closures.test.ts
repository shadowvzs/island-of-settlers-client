import { expect, it } from "vitest";

import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { Archipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { closedRoadDecorationReturnProblem, queueClosedRoadDecorations, receiveClosedRoadDecorations } from "../src/shared/settlement/road-decoration-closures";

const item = "roadDecoration:indigenous-flower-pot:native";
it("discarded-world receipts preserve placed plus pending units without mutating the old branch or enqueuing twice", () => {
  const source = { settlement: { roadDecorations: { placed: [{ uid: 1, item }], returns: [{ source: 2, item }] } } } as unknown as GameSaveV1;
  const old = { version: 1, active: null, colonies: [] } as Archipelago;
  const queued = queueClosedRoadDecorations(old, "colony-7", source);
  expect(old).not.toHaveProperty("closedRoadDecorations");
  expect(queued.closedRoadDecorations).toEqual([{ island: "colony-7", items: { [item]: 2 } }]);
  expect(queueClosedRoadDecorations(queued, "colony-7", source)).toBe(queued);
  const progress = { ...createPlayerProgress(1), inventory: { [item]: 1 } };
  expect(receiveClosedRoadDecorations(progress, queued.closedRoadDecorations!, false)?.inventory?.[item]).toBe(3);
  expect(progress.inventory[item]).toBe(1);
  expect(receiveClosedRoadDecorations(progress, queued.closedRoadDecorations!, true)).toBe(progress);
});

it("forged, duplicate or overflowing closure returns refuse the complete batch", () => {
  expect(closedRoadDecorationReturnProblem([{ island: "home", items: { [item]: 1 } }])).not.toBeNull();
  expect(closedRoadDecorationReturnProblem([{ island: "colony-1", items: { chooseNation: 1 } }])).not.toBeNull();
  expect(closedRoadDecorationReturnProblem([{ island: "colony-1", items: { [item]: 1 } },
    { island: "colony-1", items: { [item]: 1 } }])).not.toBeNull();
  const progress = { ...createPlayerProgress(1), inventory: { [item]: 999_999 } };
  expect(receiveClosedRoadDecorations(progress, [{ island: "adventure-3", items: { [item]: 2 } }], false)).toBeNull();
  expect(progress.inventory[item]).toBe(999_999);
});
