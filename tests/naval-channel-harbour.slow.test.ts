import { describe, expect, it } from "vitest";

import { CHANNEL_JAM_SECONDS, channelTradeSeconds } from "./helpers/naval-channel-harbour";

/** NAV-01 fleet grid: colony ship home after 0..150 s × trade ship sent after 0..120 s (208 runs). */
const COLONY_TIMERS = Array.from({ length: 16 }, (_, index) => index * 10);
const TRADE_DELAYS = Array.from({ length: 13 }, (_, index) => index * 10);

describe("NAV-01 channel harbour fleet grid", () => {
  it.each(COLONY_TIMERS)("colony ship home after %i s: every trade ship loads", colony => {
    const jams = TRADE_DELAYS.filter(trade => channelTradeSeconds(colony, trade) >= CHANNEL_JAM_SECONDS);
    expect(jams).toEqual([]);
  }, 120000);
});
