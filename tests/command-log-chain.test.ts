import { describe, expect, it } from "vitest";

import { createCommandLogChain } from "../src/app/save-store/command-log-chain";
import type { CommandLogInterval } from "../src/shared/settlement/command-log";

const interval = (baseTick: number) => ({ baseTick, baseRevision: null }) as unknown as CommandLogInterval;

describe("command log chain between uploads", () => {
  it("carries every unconfirmed interval from the last confirmed revision", () => {
    const chain = createCommandLogChain();
    chain.restart(5);
    const first = chain.add(interval(1));
    expect(first.intervals.map(entry => [entry.baseTick, entry.baseRevision])).toEqual([[1, 5]]);
    const unsent = new ArrayBuffer(1);
    chain.sent(unsent, first.last);
    const second = chain.add(interval(2));
    expect(second.intervals.map(entry => [entry.baseTick, entry.baseRevision])).toEqual([[1, 5], [2, null]]);
    const body = new ArrayBuffer(1);
    chain.sent(body, second.last);
    chain.add(interval(3));
    chain.confirmed(body, 6);
    expect(chain.add(null).intervals.map(entry => [entry.baseTick, entry.baseRevision])).toEqual([[3, 6]]);
  });

  it("starts without a verified base after a restored local copy", () => {
    const chain = createCommandLogChain();
    chain.restart(null);
    expect(chain.add(interval(1)).intervals[0]!.baseRevision).toBeNull();
  });

  it("rebases after a server stock move and marks the next interval not replayable", () => {
    const chain = createCommandLogChain();
    chain.restart(5);
    chain.add(interval(1));
    chain.rebase(6, "server moved goods");
    expect(chain.add(interval(2)).intervals).toEqual([
      { ...interval(2), baseRevision: 6, gaps: ["server moved goods"] }
    ]);
  });
});
