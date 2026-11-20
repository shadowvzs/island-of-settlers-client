import { expect, it, vi } from "vitest";

import type { PendingCommand } from "../src/app/components/helpers";
import { createDecorationPreviewActions, getDecorationPreviewOffer } from "../src/app/settlement-ui/gem-shop/decoration-preview";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";


const offerId = "road-decoration-roman-rusticated-arch-limestone";
const fixture = () => {
  const player = { nation: "roman", level: 1, experience: 0, current: 0, needed: 100,
    fraction: 0, gems: 50, quests: [], stock: {}, talents: {} };
  const store = createSettlementUiStore({ player });
  const buy = vi.fn<(id: string) => PendingCommand>(() => true), close = vi.fn();
  return { actions: createDecorationPreviewActions(store, { onBuyGemOffer: buy }, close), buy, close, player, store };
};
it("selecting and cancelling only changes the preview, never gems or inventory", () => {
  const { actions, buy, player, store } = fixture();
  expect(actions.select(offerId)).toBe(true);
  expect(actions.selection.getSnapshot()).toBe(offerId);
  expect(buy).not.toHaveBeenCalled();
  actions.cancel(); actions.buy();
  expect(actions.selection.getSnapshot()).toBeUndefined();
  expect(buy).not.toHaveBeenCalled();
  expect(store.getSnapshot().player).toBe(player);
});
it("Buy consumes selection before an asynchronous submission so repeated activation cannot buy twice", () => {
  const { actions, buy } = fixture();
  const pending = new Promise<true>(() => undefined);
  buy.mockImplementation(() => { actions.buy(); return pending; });
  actions.select(offerId); actions.buy(); actions.buy();
  expect(buy).toHaveBeenCalledExactlyOnceWith(offerId);
  expect(actions.selection.getSnapshot()).toBeUndefined();
});
it("checks current affordability at confirmation and rejects unavailable and non-decoration offers", () => {
  const { actions, buy, player, store } = fixture();
  actions.select(offerId);
  store.update({ player: { ...player, gems: 0 } });
  actions.buy();
  expect(buy).not.toHaveBeenCalled();
  expect(getDecorationPreviewOffer(offerId, { gems: 0, level: 1 })?.disabled).toBe(true);
  actions.cancel();
  expect(actions.select("coins-500")).toBe(false);
  expect(actions.select("road-decoration-nonexistent-native")).toBe(false);
  expect(actions.selection.getSnapshot()).toBeUndefined();
});
