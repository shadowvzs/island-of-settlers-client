import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { UI_TEST_URL } from "../../fixtures/server";
import { expectFocusInside, expectInsideViewport, expectKeyboardMove } from "../../fixtures/ui";

/**
 * TRADE-01 phase 4: the harbour's trade office. The smoke island has no harbour plot, so (like the wave 3b
 * expedition windows) the real settlement UI (`createSettlementUi`) runs on a second, empty page of the same
 * browser with a harbour in its snapshot and a recording trade office whose command results the cases set.
 * Real entry point (harbour details' market button), lazy load, focus, Escape order (dialog, picker, window),
 * keyboard, fit, home island only. Values and markup are in `tests/trade-office.test.ts`.
 */
declare global {
  interface Window {
    __tradeHarness: {
      buyResult: true | string;
      calls: unknown[][];
      focusBuilding: (id: string) => void;
      placeResult: true | string;
      update: (snapshot: object) => void;
    };
  }
}

const SNAPSHOT = {
  buildings: [{ completed: true, id: "5", type: 39 }], player: { level: 1, quests: [], talents: {} }, playerNation: "roman"
};

/** An empty page of the same browser with the real settlement UI and a recording trade office. */
const openHarness = async (game: Page, screen: { height: number; width: number }) => {
  const page = await game.context().browser()!.newPage({ viewport: screen });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/trade-harness.html", route =>
    route.fulfill({ body: "<body><div id='viewport'></div></body>", contentType: "text/html" }));
  await page.goto(`${UI_TEST_URL}trade-harness.html`);
  await page.evaluate(async snapshot => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    await load("/src/app/styles.css");
    const { createSettlementUi } = await load("/src/app/settlement-ui/index.ts");
    const lot = (amount: number, ware: string) => ({ amount, ware });
    const offer = (id: string, merchant: string, give: object, want: object) =>
      ({ give, id, merchant, status: "open", want });
    const state = {
      deliveries: [] as object[], escrow: [{ goods: { planks: 20 }, held: [], id: "e1", purpose: "offer",
        ref: "o1", staged: { planks: 20 } }],
      history: [{ at: Date.UTC(2026, 9, 18, 9, 30), gave: lot(10, "fish"), id: "h1", kind: "bought",
        merchant: "Livia Portus", received: lot(6, "planks") }] as object[],
      market: { day: 0, level: 1, offers: [offer("m0-0", "Livia Portus", lot(6, "planks"), lot(10, "fish")),
        offer("m0-1", "Bjorn Saltbeard", lot(30, "stone"), lot(2, "hammer")),
        offer("m0-2", "Chiyo Hamada", lot(3, "bread"), lot(5, "logs"))] },
      npcTraders: false,
      offers: [{ escrowId: "e1", fillAt: null, give: lot(20, "planks"), id: "o1", placedAt: 0, placedTime: 0,
        want: lot(9, "fish") }] as object[] as { give: object; id: string }[]
    };
    const stock: Record<string, number> = { fish: 40, planks: 25 };
    const room: Record<string, number> = { stone: 0 };
    const calls: unknown[][] = [];
    const harness = { buyResult: true as true | string, calls, focusBuilding: (_id: string) => {},
      placeResult: true as true | string, update: (_snapshot: object) => {} };
    let next = 2;
    const trade = {
      offerLimit: 5,
      buy: (id: string) => {
        calls.push(["buy", id]);
        if (harness.buyResult === true) state.market.offers.find(entry => entry.id === id)!.status = "taken";
        return harness.buyResult;
      },
      cancelOffer: (id: string) => {
        calls.push(["cancel", id]);
        state.offers = state.offers.filter(entry => entry.id !== id);
        return true;
      },
      checkBuy: (id: string) => (id === "m0-2" ? "Not enough free Softwood logs: needs 5, 0 free" : true),
      checkPlace: () => true,
      estimate: (give: { amount: number }, want: { amount: number }) =>
        (want.amount > give.amount ? "unlikely" : "likely"),
      freeCapacity: (ware: string) => room[ware] ?? 200,
      freeStock: (ware: string) => stock[ware] ?? 0,
      placeOffer: (give: object, want: object) => {
        calls.push(["place", give, want]);
        if (harness.placeResult === true)
          state.offers.push({ escrowId: `e${next}`, fillAt: null, give, id: `o${next++}`, placedAt: 0,
            placedTime: 0, want } as { give: object; id: string });
        return harness.placeResult;
      },
      snapshot: () => structuredClone(state)
    };
    const ui = createSettlementUi({
      onMinimap: () => {}, onRoadMode: () => {}, onRotate: () => {}, onSelectBuilding: () => {},
      onSettings: () => {}, trade
    });
    harness.focusBuilding = (id: string) => ui.focusBuilding(id);
    harness.update = (next: object) => ui.update(next);
    ui.update(snapshot);
    ui.onIslandShown();
    window.__tradeHarness = harness;
  }, SNAPSHOT);
  return { errors, page };
};

let harness: Awaited<ReturnType<typeof openHarness>> | undefined;
const harnessPage = async ({ page, screen }: { page: Page; screen: { height: number; width: number } }) => {
  harness ??= await openHarness(page, screen);
  return harness.page;
};
const calls = (page: Page) => page.evaluate(() => window.__tradeHarness.calls.splice(0));
const setResult = (page: Page, key: "buyResult" | "placeResult", value: true | string) =>
  page.evaluate(([name, result]) => { window.__tradeHarness[name as "buyResult"] = result; }, [key, value] as const);
const tradeWindow = (page: Page) => page.getByRole("dialog", { name: "Market", exact: true });

/** Harbour details → market button: the trade office window opens (React loads on the first open). */
const openTradeOffice = async (page: Page) => {
  await page.evaluate(() => window.__tradeHarness.focusBuilding("5"));
  await page.getByRole("button", { name: "Market", exact: true }).click();
  const office = tradeWindow(page);
  await expect(office.locator(".trade-office")).toBeVisible();
  return office;
};
const footer = (page: Page, name: string) =>
  tradeWindow(page).getByRole("navigation", { name: "Market sections" }).getByRole("button", { name });

test.describe("trade office", () => {
  test.describe.configure({ mode: "serial" });
  test.afterAll(async () => {
    expect(harness?.errors ?? [], "harness page errors").toEqual([]);
    await harness?.page.close();
    harness = undefined;
  });

  test("market: harbour entry, filters, search, Buy states, error dialog, Escape order", async ({ game }) => {
    const page = await harnessPage(game);
    const office = await openTradeOffice(page);
    await expectFocusInside(office);
    await expectInsideViewport(page, office);
    await expectKeyboardMove(page, office, office.locator(".settlement-ui__drag-handle"));
    const rows = office.locator(".trade-office__row");
    await expect(rows).toHaveCount(3);
    await office.getByLabel("Category", { exact: true }).selectOption({ label: "Food" });
    await expect(rows).toHaveCount(2);
    await office.getByLabel("Category", { exact: true }).selectOption({ label: "All" });
    const search = office.getByRole("searchbox", { name: "Search wares" });
    await search.fill("PLANK");
    await expect(rows).toHaveCount(1);
    await search.fill("");
    await expect(rows.nth(0)).toHaveAttribute("data-offer-id", "m0-0");
    const buyPlanks = office.getByRole("button", { name: "Buy 6 Softwood planks for 10 Fish" });
    await expect(buyPlanks).toBeEnabled();
    await expect(office.getByRole("button", { name: "Buy 30 Stone for 2 Hammers" }))
      .toHaveAttribute("title", "Storage for Stone is full");
    await expect(office.getByRole("button", { name: "Buy 3 Bread for 5 Softwood logs" })).toBeDisabled();
    await setResult(page, "buyResult", "This offer was already taken");
    await buyPlanks.click();
    const error = page.getByRole("alertdialog", { name: "Purchase failed" });
    await expect(error).toContainText("This offer was already taken");
    await expect(error.getByRole("button", { name: "OK" })).toBeFocused();
    await expectInsideViewport(page, error);
    await page.keyboard.press("Escape");
    await expect(error).toBeHidden();
    await expect(office).toBeVisible();
    await expect(buyPlanks).toBeFocused();
    await setResult(page, "buyResult", true);
    await buyPlanks.click();
    await expect(office.locator(".trade-office__status-line"))
      .toContainText("Bought 6 Softwood planks: a trade ship brings them.");
    await expect(rows.nth(0)).toHaveAttribute("data-taken", "true");
    expect(await calls(page)).toEqual([["buy", "m0-0"], ["buy", "m0-0"]]);
    await page.keyboard.press("Escape");
    await expect(office).toBeHidden();
  });

  test("place offer: pickers, amount, slider, estimate, refused and accepted confirm", async ({ game }) => {
    const page = await harnessPage(game);
    const office = await openTradeOffice(page);
    await footer(page, "Place offer").click();
    await expect(office.getByText("Active offers: 1/5")).toBeVisible();
    await office.getByRole("button", { name: "Choose what you give" }).click();
    const give = office.getByRole("group", { name: "Choose what you give" });
    await expect(give.locator("[data-ware]")).toHaveCount(2);
    await give.getByRole("button", { name: "Fish: 40 free" }).click();
    const amount = give.getByRole("spinbutton", { name: "Amount to give" });
    await amount.fill("12");
    await expect(amount).toBeFocused();
    const slider = give.getByRole("slider", { name: "Amount to give slider" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(amount).toHaveValue("13");
    await page.keyboard.press("Escape");
    await expect(give).toBeHidden();
    await expect(office).toBeVisible();
    await expect(office.getByRole("button", { name: "I give: 13 Fish" })).toBeFocused();
    await office.getByRole("button", { name: "Choose what you want" }).click();
    const want = office.getByRole("group", { name: "Choose what you want" });
    await expect(want.locator("[data-ware='stone']")).toHaveCount(0);
    // Offered and requested wares differ: the ware given is not offered on the want side.
    await expect(want.locator("[data-ware='fish']")).toHaveCount(0);
    await want.locator("[data-ware='bread']").click();
    await want.getByRole("button", { name: "Done" }).click();
    await expect(office.locator(".trade-office__estimate")).toHaveText("Merchants will likely accept");
    await expectInsideViewport(page, office);
    await setResult(page, "placeResult", "Not enough free Fish: needs 13, 5 free");
    await office.getByRole("button", { name: "Place offer now" }).click();
    const error = page.getByRole("alertdialog", { name: "Offer not placed" });
    await expect(error).toContainText("Not enough free Fish");
    await error.getByRole("button", { name: "OK" }).click();
    await setResult(page, "placeResult", true);
    await office.getByRole("button", { name: "Place offer now" }).click();
    await expect(office.getByRole("region", { name: "My offers" })).toBeVisible();
    await expect(office.locator("[data-own-offer]")).toHaveCount(2);
    expect((await calls(page)).map(call => call[0])).toEqual(["place", "place"]);
    await page.keyboard.press("Escape");
  });

  test("my offers: NPC note, cancel confirmation, history with dates", async ({ game }) => {
    const page = await harnessPage(game);
    const office = await openTradeOffice(page);
    await footer(page, "My offers").click();
    await expect(office.locator("[data-npc-traders='off']")).toBeVisible();
    await office.getByRole("button", { name: "Cancel offer 20 Softwood planks for 9 Fish" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel this offer?" });
    await expect(confirm).toContainText("20 Softwood planks return to your storage at once");
    await expect(confirm.getByRole("button", { name: "Keep offer" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel offer", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(office.locator("[data-own-offer='o1']")).toHaveCount(0);
    expect(await calls(page)).toEqual([["cancel", "o1"]]);
    await footer(page, "History").click();
    await expect(office.locator("[data-history-kind='bought'] time")).not.toBeEmpty();
    await expectInsideViewport(page, office);
    await page.keyboard.press("Escape");
    await expect(office).toBeHidden();
  });

  test("home island only: no market on a colony harbour, an open window closes on the switch", async ({ game }) => {
    const page = await harnessPage(game);
    const office = await openTradeOffice(page);
    await page.evaluate(() => window.__tradeHarness.update({ activeColony: 2 }));
    await expect(office).toBeHidden();
    await page.evaluate(() => window.__tradeHarness.focusBuilding("5"));
    await expect(page.locator(".settlement-ui__building-details-window")).toBeVisible();
    await expect(page.getByRole("button", { name: "Market", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__tradeHarness.update({ activeColony: null }));
    await expect(page.getByRole("button", { name: "Market", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
