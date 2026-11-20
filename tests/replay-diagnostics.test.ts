import { expect, it } from "vitest";

import { createReplayDiagnostics } from "../src/shared/settlement/replay-diagnostics";
it("bounds slow-frame history and keeps cumulative timing and search work", () => {
  const diagnostics = createReplayDiagnostics();
  for (let frame = 0; frame < 100; frame++) diagnostics.step(frame / 20, 20, { groundVisits: 17 });
  diagnostics.command("callOutMilitary", 24);
  const snapshot = diagnostics.snapshot();
  expect(snapshot.steps).toBe(100); expect(snapshot.slow).toHaveLength(32);
  expect(snapshot.work.groundVisits).toBe(1700);
  expect(snapshot.histogram.reduce((sum, count) => sum + count, 0)).toBe(100);
  expect(snapshot.commands.callOutMilitary!.maximumMs).toBe(24);
  snapshot.slow.length = 0; expect(diagnostics.snapshot().slow).toHaveLength(32);
});
