import { expect, it } from "vitest";

import { addColonyNativeCoverage, settleColonyNativeOre, validColonyNativeEconomy } from "../src/shared/settlement/colony-native-economy";

const HOUR = 3600_000;
it("subtracts a short native window ending before the due slot without losing uncovered production", () => {
  const state = addColonyNativeCoverage(undefined, HOUR / 4, HOUR / 2);
  const result = settleColonyNativeOre(state, HOUR, HOUR, 1, 1, 100);
  expect(result.ore).toBe(45); expect(result.food).toBe(45);
  expect(result.nativeEconomy.coverage).toEqual([]); expect(result.nativeEconomy.oreRemainder).toBe(0);
});
it("merges overlaps and splits a straddled due slot across a full save boundary", () => {
  let state = addColonyNativeCoverage(undefined, .75 * HOUR, HOUR);
  state = addColonyNativeCoverage(state, .9 * HOUR, 1.25 * HOUR);
  expect(state.coverage).toEqual([[.75 * HOUR, 1.25 * HOUR]]);
  const first = settleColonyNativeOre(state, HOUR, HOUR, 1, 1, 200);
  expect(first.ore).toBe(45); expect(first.nativeEconomy.coverage).toEqual([[HOUR, 1.25 * HOUR]]);
  const reloaded = JSON.parse(JSON.stringify(first.nativeEconomy));
  const second = settleColonyNativeOre(reloaded, 2 * HOUR, HOUR, 1, 1, 155);
  expect(second.ore).toBe(45); expect(second.food).toBe(45);
});
it("credits nothing for a fully native slot and debits no food", () => {
  const result = settleColonyNativeOre(addColonyNativeCoverage(undefined, 0, HOUR), HOUR, HOUR, 1, 5, 100);
  expect(result.ore).toBe(0); expect(result.food).toBe(0);
});
it("retains fractional budget through restore, drops unfunded whole work, and never creates XP", () => {
  const first = settleColonyNativeOre(addColonyNativeCoverage(undefined, 1, HOUR), HOUR, HOUR, 1, 1, 0);
  expect(first.ore).toBe(0); expect(first.nativeEconomy.oreRemainder).toBeCloseTo(1 / 60_000, 12);
  const next = addColonyNativeCoverage(JSON.parse(JSON.stringify(first.nativeEconomy)), HOUR + 59_999, 2 * HOUR);
  const second = settleColonyNativeOre(next, 2 * HOUR, HOUR, 1, 1, 2);
  expect(second.ore).toBe(1); expect(second.nativeEconomy.oreRemainder).toBeCloseTo(0, 12);
  const dry = settleColonyNativeOre(second.nativeEconomy, 3 * HOUR, HOUR, 1, 1, 0);
  expect(dry.ore).toBe(0); expect(dry.nativeEconomy.oreRemainder).toBe(0);
  expect(dry).not.toHaveProperty("experience");
});
it("validates bounded disjoint coverage and merges adjacent native chunks", () => {
  const state = addColonyNativeCoverage(addColonyNativeCoverage(undefined, 10, 20), 20, 30);
  expect(state.coverage).toEqual([[10, 30]]); expect(validColonyNativeEconomy(state)).toBe(true);
  expect(validColonyNativeEconomy({ ...state, coverage: [[10, 30], [20, 40]] })).toBe(false);
});
