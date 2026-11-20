import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { findMapPoint, nextFrames, PHONE_WIDTH } from "../../fixtures/ui";
import { armyCursor, focusGround, removeSquad, selectSoldier, spawnSquad } from "./army-orders";

/** The troop ship queries and commands the UI calls; the cases record them and may replace the answer. */
const STUBBED = [
  "embarkMilitary", "landShipTroops", "sailShip", "troopShipActions", "troopShipBoardingCheck",
  "troopShipDestinationCheck", "troopShipStatus"
] as const;
type Stubbed = (typeof STUBBED)[number];

interface ShipScene { id: number; x: number; z: number }

export const HOME_ACTIONS = { board: false, carrying: true, multiIsland: false, returnHome: null, role: "home",
  sailTo: false, unload: true };
export const STATUS = { aboard: 4, anchored: false, boarding: 0, capacityLeft: 12, landing: 0, mission: true,
  ready: true };

/**
 * One own fleet ship on the smoke island's sea (the development "Create ship", nearest deep water to the
 * headquarters). The smoke island has no harbour plot, so the real simulation refuses boarding there ("not docked");
 * the cases spy on the troop ship API and replace answers where a docked or loaded ship is needed. The simulation
 * behaviour itself is covered by tests/troop-ships.slow.test.ts.
 */
export const spawnShip = (page: Page) => page.evaluate((stubbed): ShipScene => {
  const simulation = (window as any).__settlement.simulation;
  const home = simulation.buildings().find((building: any) => building.typeId === 0);
  const world = (window as any).__settlement.world ?? { cellsX: 64, cellsZ: 64 };
  const points: { x: number; z: number }[] = [];
  for (let z = 1.5; z < world.cellsZ; z += 2) for (let x = 1.5; x < world.cellsX; x += 2) points.push({ x, z });
  points.sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
  let spawned: { id: number; x: number; z: number } | undefined;
  const reasons: Record<string, number> = {};
  for (const point of points) {
    const result = simulation.spawnDebugShip(point);
    if (result.ok) { spawned = { id: result.id, ...point }; break; }
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
  }
  if (!spawned) throw new Error(`No deep water for the troop ship: ${JSON.stringify({ reasons, world: [world.cellsX, world.cellsZ] })}`);
  const calls: Record<string, unknown[][]> = (window as any).__shipCalls = {};
  const answers: Record<string, unknown> = (window as any).__shipAnswers = {};
  for (const name of stubbed) {
    const original = simulation[name];
    calls[name] = [];
    simulation[name] = (...args: unknown[]) => {
      calls[name]!.push(args);
      return name in answers ? answers[name] : original.apply(simulation, args);
    };
    simulation[name].__original = original;
  }
  const ship = simulation.ships().find((entry: any) => entry.id === spawned!.id);
  return { id: spawned.id, x: ship?.x ?? spawned.x, z: ship?.z ?? spawned.z };
}, STUBBED);

export const removeShip = (page: Page, ship: ShipScene) => page.evaluate(({ id, stubbed }) => {
  const simulation = (window as any).__settlement.simulation;
  for (const name of stubbed) if (simulation[name].__original) simulation[name] = simulation[name].__original;
  simulation.sinkShip(id);
}, { id: ship.id, stubbed: STUBBED });

export const answer = (page: Page, name: Stubbed, value: unknown) => page.evaluate(([command, result]) => {
  (window as any).__shipAnswers[command as string] = result;
}, [name, value] as const);
const shipCalls = (page: Page, name: Stubbed) =>
  page.evaluate(command => (window as any).__shipCalls[command] as unknown[][], name);
/** The settlement messages of the case, read in the News notices (opened last: Escape would end a mode). */
const expectMessages = async (page: Page, texts: readonly string[]) => {
  await page.getByRole("button", { exact: true, name: "News" }).click();
  for (const text of texts)
    await expect(page.getByText(text, { exact: true }).first(), `message: ${text}`).toBeVisible();
};

/** The ship's viewport point (deck height) after centring the camera on it. */
const shipPoint = async (page: Page, ship: ShipScene) => {
  await focusGround(page, ship.x, ship.z);
  await nextFrames(page);
  return page.evaluate(id => {
    const settlement = (window as any).__settlement;
    const found = settlement.simulation.ships().find((entry: any) => entry.id === id);
    return settlement.project(found.x, .8, found.z) as { x: number; y: number };
  }, ship.id);
};

/** Left-clicks the ship until its window opens (the hull model may still be loading). */
export const openShipWindow = async (page: Page, ship: ShipScene) => {
  const register = page.locator(".settlement-ui__ship-window");
  for (let attempt = 0; attempt < 20 && !(await register.isVisible()); attempt++) {
    const point = await shipPoint(page, ship);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
  }
  await expect(register, "the ship window opens on a left click").toBeVisible();
  return register;
};

/** Ship troop UI, military controls §9 (P4a board, P4b ship orders). */
test.describe("troop ships", () => {
  test.beforeEach(({ game: { screen } }) => {
    test.skip(screen.width < PHONE_WIDTH, "mouse right click; phones order by long-press");
  });

  test("right-click an own ship with soldiers selected boards it; the hover agrees with the check", async ({ game }) => {
    const { page } = game;
    const ship = await spawnShip(page);
    const squad = await spawnSquad(page, ["shield"]);
    try {
      await selectSoldier(page, squad.ids[0]!);
      const point = await shipPoint(page, ship);
      await page.mouse.move(point.x + 2, point.y + 2);
      await page.mouse.move(point.x, point.y);
      await expect.poll(() => armyCursor(page), "an undocked ship: invalid cursor (real boarding check)")
        .toBe("invalid");
      await answer(page, "troopShipBoardingCheck",
        { boarding: squad.ids, capacityLeft: 14, ok: true, pickup: false, waiting: [] });
      await answer(page, "embarkMilitary", { boarding: squad.ids, ok: true, waiting: [] });
      await page.mouse.move(point.x + 1, point.y);
      await expect.poll(() => armyCursor(page), "a boardable ship: board cursor").toBe("board");
      for (let attempt = 0; attempt < 10 && !(await shipCalls(page, "embarkMilitary")).length; attempt++) {
        await page.mouse.click(point.x, point.y, { button: "right" });
        await page.waitForTimeout(300);
      }
      expect((await shipCalls(page, "embarkMilitary"))[0]).toEqual([squad.ids, ship.id]);
      await expectMessages(page, ["1 soldier boarding."]);
    } finally {
      await removeSquad(page, squad.ids);
      await removeShip(page, ship);
    }
  });

  test("ship panel Unload troops: a valid coast lands, an invalid one shows the reason", async ({ game }) => {
    const { page } = game;
    const ship = await spawnShip(page);
    try {
      await answer(page, "troopShipActions", HOME_ACTIONS);
      await answer(page, "troopShipStatus", STATUS);
      const register = await openShipWindow(page, ship);
      const unload = register.locator("[data-ship-troop-action='unload']");
      await expect(unload).toBeVisible();
      await expect(register.locator("[data-ship-troops]")).toContainText("4 soldiers aboard · 12 free deck slots");
      await expect(register.locator("[data-ship-troop-action='sail']"), "single island: no Sail to").toHaveCount(0);
      await unload.click();
      await expect.poll(() => armyCursor(page)).toBe("unload");
      await expect(unload).toHaveAttribute("aria-pressed", "true");
      // Invalid coast: the check refuses; the reason shows, nothing is recorded and the mode stays armed.
      await answer(page, "troopShipDestinationCheck", { ok: false, reason: "No landing beach here" });
      const ground = await findMapPoint(page);
      await page.mouse.click(ground.x, ground.y);
      expect((await shipCalls(page, "troopShipDestinationCheck"))[0]![0]).toBe(ship.id);
      expect(await shipCalls(page, "landShipTroops")).toEqual([]);
      expect(await armyCursor(page)).toBe("unload");
      // Valid coast: the check passes, the landing command goes out and the mode ends.
      await answer(page, "troopShipDestinationCheck", { kind: "coast", ok: true });
      await answer(page, "landShipTroops", { kind: "coast", ok: true });
      await page.mouse.click(ground.x, ground.y);
      const landing = (await shipCalls(page, "landShipTroops"))[0]!;
      expect(landing[0]).toBe(ship.id);
      expect(landing[1]).toEqual(expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }));

      await expect.poll(() => armyCursor(page), "the right tap of a selected ship: land").toBe("unload");
      await expect(unload).toHaveAttribute("aria-pressed", "false");
      await expectMessages(page, ["No landing beach here", "The ship sails to the coast and lands the troops."]);
    } finally {
      await removeShip(page, ship);
    }
  });

  test("multi-island map: Sail to and the selected ship's right tap sail; soldiers and Escape end the mode",
    async ({ game }) => {
      const { page } = game;
      const ship = await spawnShip(page);
      const squad = await spawnSquad(page, ["shield"]);
      try {
        await answer(page, "troopShipActions", { ...HOME_ACTIONS, multiIsland: true, sailTo: true });
        await answer(page, "troopShipStatus", STATUS);
        await answer(page, "troopShipDestinationCheck", { kind: "harbour", ok: true });
        await answer(page, "sailShip", { kind: "harbour", ok: true });
        const register = await openShipWindow(page, ship);
        const sail = register.locator("[data-ship-troop-action='sail']");
        await expect(sail).toBeVisible();
        await expect.poll(() => armyCursor(page), "a selected ship: generic sail cursor").toBe("sail");
        const ground = await findMapPoint(page);
        await page.mouse.click(ground.x, ground.y, { button: "right" });
        await expect.poll(async () => (await shipCalls(page, "sailShip")).length, "right tap = Sail to").toBe(1);
        await sail.click();
        await expect(sail).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Escape");
        await expect(sail, "Escape ends the armed mode").toHaveAttribute("aria-pressed", "false");
        await expect(register, "and keeps the ship window").toBeVisible();
        await sail.click();
        await expect(sail).toHaveAttribute("aria-pressed", "true");
        // An armed mode takes the next left click, so soldiers are selected by the select-all key here.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("Backquote");
        await expect(sail, "selecting soldiers ends the ship mode").toHaveAttribute("aria-pressed", "false");
        expect(await armyCursor(page), "the soldiers own the cursor").not.toBe("sail");
        await expectMessages(page, ["The ship sails to the harbour and docks with the troops aboard."]);
      } finally {
        await removeSquad(page, squad.ids);
        await removeShip(page, ship);
      }
    });
});
