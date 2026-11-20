import { expect, it, vi } from "vitest";

import { settleGemShopPurchase } from "../src/app/settlement-ui/gem-shop/purchase-notification";

it("silent pending settles to exactly one important success even when transport work is asynchronous", async () => {
  let resolve: (result: true) => void = () => undefined;
  const pending = new Promise<true>(finish => { resolve = finish; });
  const notify = { success: vi.fn(() => 1), error: vi.fn(() => 2) };
  settleGemShopPurchase(pending, "Item added to inventory", undefined, notify);
  expect(notify.success).not.toHaveBeenCalled(); expect(notify.error).not.toHaveBeenCalled();
  resolve(true); await vi.waitFor(() => expect(notify.success).toHaveBeenCalledOnce());
  expect(notify.success).toHaveBeenCalledWith("Item added to inventory", { important: true });
  expect(notify.error).not.toHaveBeenCalled();
});

it("one final refused purchase emits an important actionable error, never a success or a pending toast", async () => {
  const notify = { success: vi.fn(() => 1), error: vi.fn(() => 2) };
  settleGemShopPurchase("Needs 5 more gems", "Purchased", undefined, notify);
  expect(notify.error).toHaveBeenCalledExactlyOnceWith("Needs 5 more gems", { important: true });
  expect(notify.success).not.toHaveBeenCalled();
  notify.error.mockClear();
  settleGemShopPurchase(Promise.reject(new Error("offline")), "Purchased", undefined, notify);
  await vi.waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
  expect(notify.error).toHaveBeenCalledWith("The server did not answer. Please try again.", { important: true });
});
