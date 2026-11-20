import { describe, expect, it } from "vitest";

import { createPlayerRoadDecorationCustody } from "../src/app/settlement/player-road-decoration-custody";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

const item = "roadDecoration:roman-rusticated-arch:limestone";
describe("player road decoration custody", () => {
  it("debits one local stack unit and preflights an entire return batch", () => {
    let progress = { ...createPlayerProgress(1), inventory: { [item]: 2 } };
    const port = createPlayerRoadDecorationCustody({ active: () => true, get: () => progress,
      commit: next => { progress = next as typeof progress; }, online: false, simulation: () => undefined });
    expect(port.consume(item)).toBe(true);
    expect(progress.inventory[item]).toBe(1);
    expect(port.receive({ [item]: 1, forged: 1 })).toBe(false);
    expect(progress.inventory[item]).toBe(1);
    expect(port.receive({ [item]: 1 })).toBe(true);
    expect(progress.inventory[item]).toBe(2);
  });
  it("refuses local online wallet edits and coalesces private return requests", async () => {
    const progress = { ...createPlayerProgress(1), inventory: { [item]: 2 } };
    let requests = 0, commits = 0;
    const port = createPlayerRoadDecorationCustody({ active: () => true, get: () => progress,
      commit: () => { commits++; }, online: true, simulation: () => undefined,
      requestServerReturns: () => { requests++; } });
    expect(port.consume(item)).toBe(false); expect(port.receive({ [item]: 1 })).toBe(false);
    port.onReturns?.(); port.onReturns?.(); await Promise.resolve();
    expect(commits).toBe(0); expect(requests).toBe(1);
  });
  it("drops queued notifications after the island session is disposed", async () => {
    let active = true, requests = 0;
    const port = createPlayerRoadDecorationCustody({ active: () => active, get: () => createPlayerProgress(1),
      commit: () => undefined, online: true, simulation: () => undefined,
      requestServerReturns: () => { requests++; } });
    port.onReturns?.(); active = false; await Promise.resolve(); expect(requests).toBe(0);
  });
});
