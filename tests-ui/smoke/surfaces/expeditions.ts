import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { UI_TEST_URL } from "../../fixtures/server";
import { expectFocusInside, expectInsideViewport, expectKeyboardMove } from "../../fixtures/ui";

/**
 * Wave 3b: settlement popup, colony tracker, ship register and colony planner.
 * The popup opens in the game itself (`announceLevelUp`). The smoke island has no harbour plot, so the
 * fleet and expedition windows run in the real settlement UI (`createSettlementUi`) on a second, empty
 * page of the same browser fed with a fixed snapshot: real entry points (Menu > Ships row, the harbour
 * details' Colony expedition button), focus, Escape, drag, collapse and reopen policy. Values and markup
 * are in `tests/settlement-ui-expeditions` and `tests/settlement-ui-fleet`.
 */
declare global {
  interface Window {
    __expeditionHarness: {
      calls: unknown[][];
      focusBuilding: (id: string) => void;
      startResult: true | string;
      update: (snapshot: object) => void;
    };
  }
}

type LevelUps = { announceLevelUp: (levelUps: { coins: number; gems: number; level: number }[]) => void };
const announceLevel = (page: Page, level: number, gems = 0) => page.evaluate(levelUp =>
  (window as unknown as { __settlement: LevelUps }).__settlement.announceLevelUp([levelUp]), { coins: 5, gems, level });
const levelUpPopup = (page: Page, level: number) => page.getByRole("alertdialog", { name: `Level ${level}!` });
const tracker = (page: Page) => page.getByRole("complementary", { name: "Colonies and expeditions" });

const ISLAND = { difficulty: "easy", id: 3, name: "Amber Reef", ore: "ironOre", seed: 1, voyageSeconds: 90 };
const SNAPSHOT = {
  buildings: [{ completed: true, id: "5", type: 39 }],
  colonies: [{ id: 2, island: { ...ISLAND, difficulty: "medium", id: 4, name: "Stormcairn", ore: "coal" }, status: "landed" }],
  colonyExpeditions: [{ arrived: 0, cargo: { planks: 4 }, crewReady: false, departed: 0, id: 1, island: ISLAND,
    landed: {}, loads: 2, remainingSeconds: null, sourceUid: 5, status: "preparing", suppliesReady: true,
    troops: { archer: 2, cavalry: 0, heavy: 0, shield: 3 } }],
  colonyIslands: [{ ...ISLAND, taken: false }],
  colonyTroops: { archer: 4, cavalry: 0, heavy: 0, shield: 6 },
  // EXPEDITION-READINESS: a launch needs an idle own ship.
  idleExpeditionShips: 1,
  playerNation: "roman",
  ships: [{ id: "s1", name: "Ship 1", status: "idle", wares: { planks: 3 } },
    { id: "s2", name: "Ship 2", status: "sailing", wares: { stone: 7 } }]
};

/** An empty page of the same browser with the real settlement UI and recording callbacks. */
const openHarness = async (game: Page, screen: { height: number; width: number }) => {
  const page = await game.context().browser()!.newPage({ viewport: screen });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/expedition-harness.html", route =>
    route.fulfill({ body: "<body><div id='viewport'></div></body>", contentType: "text/html" }));
  await page.goto(`${UI_TEST_URL}expedition-harness.html`);
  await page.evaluate(async snapshot => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    await load("/src/app/styles.css");
    const { createSettlementUi } = await load("/src/app/settlement-ui/index.ts");
    const calls: unknown[][] = [];
    let following: string | null = null;
    const harness = {
      calls, focusBuilding: (id: string) => ui.focusBuilding(id), startResult: "No free ship" as true | string,
      update: (next: object) => ui.update(next)
    };
    const record = (name: string, result?: unknown) => (...args: unknown[]) => { calls.push([name, ...args]); return result; };
    const ui = createSettlementUi({
      onCancelColony: record("cancel", true), onDisbandColony: record("disband"), onFocusShip: record("locate"),
      onMinimap: () => {}, onPlanColony: () => ({ loads: 1, seconds: 90, ships: 1, trips: 1 }), onRoadMode: () => {},
      onRotate: () => {}, onSelectBuilding: () => {}, onSettings: () => {},
      onStartColony: (...args: unknown[]) => { calls.push(["start", ...args]); return harness.startResult; },
      onVisitColony: record("visit"),
      shipObservation: {
        canFollow: () => true, isFollowing: (id: string) => following === id,
        stop: (id: string) => { if (following === id) following = null; },
        toggle: (id: string) => { following = following === id ? null : id; }
      }
    });
    ui.update(snapshot);
    // The HUD (launchers, main panel views) loads once the island is on screen.
    ui.onIslandShown();
    window.__expeditionHarness = harness;
  }, SNAPSHOT);
  return { errors, page };
};

let harness: Awaited<ReturnType<typeof openHarness>> | undefined;
const harnessPage = async ({ page, screen }: { page: Page; screen: { height: number; width: number } }) => {
  harness ??= await openHarness(page, screen);
  return harness.page;
};
const calls = (page: Page) => page.evaluate(() => window.__expeditionHarness.calls.splice(0));

test.describe("expeditions", () => {
  test.describe.configure({ mode: "serial" });
  test.afterAll(async () => {
    expect(harness?.errors ?? [], "harness page errors").toEqual([]);
    await harness?.page.close();
    harness = undefined;
  });

  test("popup: alert dialog takes focus, replaces the previous one and closes", async ({ game: { page } }) => {
    await announceLevel(page, 2);
    await expect(levelUpPopup(page, 2).getByRole("button", { name: "Build", exact: true })).toBeFocused();
    await expectInsideViewport(page, levelUpPopup(page, 2));
    await announceLevel(page, 3, 2);
    await expect(levelUpPopup(page, 3).getByRole("group", { name: "Rewards" })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(1);
    // Escape outside the settlement UI reaches the popup's document listener.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(levelUpPopup(page, 3)).toBeHidden();
    // Escape with focus inside the popup closes only the popup (the HUD root used to swallow it).
    await announceLevel(page, 4);
    await expect(levelUpPopup(page, 4).getByRole("button", { name: "Build", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(levelUpPopup(page, 4)).toBeHidden();
    // Without new buildings only Close remains.
    await announceLevel(page, 12);
    await expect(levelUpPopup(page, 12).getByRole("button", { name: "Build", exact: true })).toHaveCount(0);
    await levelUpPopup(page, 12).getByRole("button", { name: "Close", exact: true }).click();
    await expect(levelUpPopup(page, 12)).toBeHidden();
  });

  test("popup: Build opens the picker on the first new building's category", async ({ game: { page } }) => {
    await announceLevel(page, 5);
    await levelUpPopup(page, 5).getByRole("button", { name: "Build", exact: true }).click();
    await expect(levelUpPopup(page, 5)).toBeHidden();
    const card = page.locator('.settlement-ui__card--new[data-building="21"]');
    await expect(card).toBeVisible();
    await expect(page.locator(".settlement-ui__card--new")).toHaveCount(3);
    // Later cases expect the picker on its first category again.
    await page.getByRole("tablist", { exact: true, name: "Building categories" }).getByRole("tab", { name: "Small", exact: true }).click();
  });

  test("colony tracker: cards, persisted collapse, keyboard move, disband confirm, cancel", async ({ game }) => {
    const page = await harnessPage(game);
    const panel = tracker(page);
    await expect(panel.locator(".colony-tracker__card")).toHaveCount(1);
    await expectInsideViewport(page, panel);
    await panel.getByRole("button", { name: "Minimise expeditions", exact: true }).click();
    await expect(panel.locator(".colony-tracker__body")).toBeHidden();
    await expect(panel.locator(".colony-tracker__handle")).toContainText("Expeditions (2)");
    expect(await page.evaluate(() => sessionStorage.getItem("island-of-settlers.colonies-collapsed"))).toBe("1");
    await expectKeyboardMove(page, panel, panel.locator(".colony-tracker__handle"));
    await panel.getByRole("button", { name: "Show expeditions", exact: true }).click();
    await panel.locator("[data-colony-visit='2']").click();
    await panel.getByRole("button", { name: "Disband Stormcairn", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Disband Stormcairn?" });
    await expect(confirm.getByRole("button", { name: "Disband", exact: true })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep colony", exact: true }).click();
    await expect(confirm).toBeHidden();
    await panel.locator(".colony-tracker__summary").click();
    await panel.getByRole("button", { name: "Cancel expedition", exact: true }).click();
    expect(await calls(page)).toEqual([["visit", 2], ["cancel", 1]]);
    await page.evaluate(() => window.__expeditionHarness.update({ colonies: [], colonyExpeditions: [] }));
    await expect(panel).toBeHidden();
  });

  test("ship register: Ships view row, Previous/Next, follow, Escape stops following", async ({ game }) => {
    const page = await harnessPage(game);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Ships", exact: true }).click();
    await page.locator("[data-ship-id='s2']").click();
    const register = page.getByRole("dialog", { name: "Ship register", exact: true });
    await expect(register.getByRole("heading", { name: "Ship 2" })).toBeVisible();
    await expect(register.locator("img.settlement-ui__ship-portrait")).toBeVisible();
    await expectFocusInside(register);
    await expectInsideViewport(page, register);
    await register.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(register.getByRole("heading", { name: "Ship 1" })).toBeVisible();
    await expect(register.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
    await register.getByRole("button", { name: "Go to place", exact: true }).click();
    const follow = register.locator("[data-follow-ship]");
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(register).toBeHidden();
    expect(await calls(page)).toEqual([["locate", "s1"]]);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Ships", exact: true }).click();
    await page.locator("[data-ship-id='s1']").click();
    await expect(register.locator("[data-follow-ship]")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
  });

  test("colony planner: harbour entry, troop stepper keeps focus, status reset, draft kept", async ({ game }) => {
    const page = await harnessPage(game);
    // The harbour's details (building details window) hold the planner's entry point.
    const openPlanner = async () => {
      await page.evaluate(() => window.__expeditionHarness.focusBuilding("5"));
      await page.locator("[data-harbour-colony='5']").click();
    };
    await openPlanner();
    const planner = page.getByRole("dialog", { name: "Colony expedition", exact: true });
    await expect(planner.getByRole("radiogroup", { name: "Colony island" })).toBeVisible();
    await expectFocusInside(planner);
    await expectInsideViewport(page, planner, true);
    await planner.getByRole("button", { name: "More swordsmen", exact: true }).click();
    const field = planner.getByRole("spinbutton", { name: "Swordsmen to send", exact: true });
    await expect(field).toHaveValue("1");
    await field.fill("99");
    await expect(field).toBeFocused();
    await field.blur();
    await expect(field).toHaveValue("6");
    await planner.getByRole("button", { name: "Start expedition", exact: true }).click();
    await expect(planner.getByRole("status")).toHaveText("No free ship");
    await page.keyboard.press("Escape");
    await expect(planner).toBeHidden();
    await openPlanner();
    await expect(field).toHaveValue("6");
    await expect(planner.getByRole("status")).toHaveText("");
    await page.evaluate(() => { window.__expeditionHarness.startResult = true; });
    await planner.getByRole("button", { name: "Start expedition", exact: true }).click();
    await expect(planner).toBeHidden();
    expect((await calls(page)).map(call => call.slice(0, 3))).toEqual([["start", 5, 3], ["start", 5, 3]]);
    await openPlanner();
    await expect(field).toHaveValue("0");
    await page.keyboard.press("Escape");
  });
});
