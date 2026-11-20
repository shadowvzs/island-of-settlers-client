import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { findMapPoint, nextFrames, PHONE_WIDTH } from "../../fixtures/ui";

interface ArmyScene {
  fort: { uid: number; x: number; z: number };
  home: { uid: number; x: number; z: number };
  soldier: number;
}

type SpiedCommand = "commandMilitary" | "garrisonMilitary" | "returnMilitaryHome" | "siegeMilitary";

/** The smallest garrison building: placed as a finished hostile fort for the siege target. */
const FORT_TYPE = 1;
const SPIED: readonly SpiedCommand[] = ["commandMilitary", "garrisonMilitary", "returnMilitaryHome", "siegeMilitary"];

/**
 * One field soldier held near home and an undefended hostile fort nearby, both made through the
 * simulation's scenario/development calls; the command spies record the military orders the map input sends.
 */
const createScene = (page: Page) => page.evaluate(({ fortType, spied }): ArmyScene => {
  const settlement = (window as any).__settlement, simulation = settlement.simulation;
  const home = simulation.buildings().find((building: any) => building.typeId === 0);
  let fort: any;
  for (let ring = 9; ring <= 21 && !fort; ring += 3) for (let step = 0; step < 16 && !fort; step++) {
    const angle = step * Math.PI / 8;
    for (const offset of [0, .5]) {
      const result = simulation.placeMilitaryScenarioBuilding(fortType,
        Math.round(home.x + Math.cos(angle) * ring) + offset, Math.round(home.z + Math.sin(angle) * ring) + offset);
      if (result.ok) { fort = result.building; break; }
    }
  }
  if (!fort) throw new Error("No free plot for the hostile fort");
  if (!simulation.registerMilitaryGarrison(fort.uid, [], 1, 200)) throw new Error("Fort door refused");
  const point = { x: home.access.x + (fort.x - home.x) / 3, z: home.access.z + (fort.z - home.z) / 3 };
  const spawned = simulation.spawnDebugSoldier(point, { rank: 0, type: "shield" });
  if (!spawned) throw new Error("No room for the field soldier");
  simulation.commandMilitary([spawned.id], point, "move");
  const calls: Record<string, unknown[][]> = (window as any).__armyCalls = {};
  for (const name of spied) {
    const original = simulation[name];
    calls[name] = [];
    simulation[name] = (...args: unknown[]) => { calls[name]!.push(args); return original.apply(simulation, args); };
    simulation[name].__original = original;
  }
  return { fort: { uid: fort.uid, x: fort.x, z: fort.z }, home: { uid: home.uid, x: home.x, z: home.z },
    soldier: spawned.id };
}, { fortType: FORT_TYPE, spied: SPIED });

const removeScene = (page: Page, scene: ArmyScene) => page.evaluate(({ fort, soldier, spied }) => {
  const simulation = (window as any).__settlement.simulation;
  for (const name of spied) if (simulation[name].__original) simulation[name] = simulation[name].__original;
  simulation.returnMilitaryHome([soldier]);
  if (simulation.buildings().some((building: any) => building.uid === fort.uid)) simulation.demolishBuilding(fort.uid);
}, { ...scene, spied: SPIED });

const calls = (page: Page, name: SpiedCommand) =>
  page.evaluate(command => (window as any).__armyCalls[command] as unknown[][], name);
const clearCalls = (page: Page) => page.evaluate(spied => {
  for (const name of spied) (window as any).__armyCalls[name] = [];
}, SPIED);

/** The viewport point of a world ground point, after centring the camera on it. */
export const focusGround = async (page: Page, x: number, z: number) => {
  await page.evaluate(([gx, gz]) => (window as any).__settlement.focusGround(gx, gz), [x, z]);
  await nextFrames(page);
  return page.evaluate(([gx, gz]) => (window as any).__settlement.projectGround(gx, gz) as { x: number; y: number },
    [x, z]);
};

/** Centres the soldier and left-clicks its chest: a recorded single selection. */
export const selectSoldier = async (page: Page, id: number) => {
  const actor = await page.evaluate(uid => {
    const found = (window as any).__settlement.simulation.frames().find((entry: any) => entry.uid === uid);
    return { x: found.x, z: found.z };
  }, id);
  await focusGround(page, actor.x, actor.z);
  const chest = await page.evaluate(uid => {
    const settlement = (window as any).__settlement;
    const found = settlement.simulation.frames().find((entry: any) => entry.uid === uid);
    return settlement.project(found.x, found.y + .55, found.z) as { x: number; y: number };
  }, id);
  await page.mouse.click(chest.x, chest.y);
  await expect.poll(() => page.evaluate(uid => (window as any).__settlement.simulation.militarySoldiers()
    .find((soldier: any) => soldier.actor === uid)?.combat?.selected, id), "the soldier is selected").toBe(true);
};

/** Right-clicks the building until the order arrives (its model may still be loading). */
const rightClickBuilding = async (page: Page, target: { x: number; z: number }, command: SpiedCommand) => {
  const point = await focusGround(page, target.x, target.z);
  for (let attempt = 0; attempt < 20 && !(await calls(page, command)).length; attempt++) {
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.waitForTimeout(500);
  }
  const state = await page.evaluate(() => ({
    calls: (window as any).__armyCalls,
    marker: document.querySelector<HTMLElement>(".army-order-marker")?.dataset.order,
    status: document.querySelector(".settlement-ui__status, [role=status]")?.textContent
  }));
  expect((await calls(page, command)).length, `no ${command}: ${JSON.stringify(state)}`).toBeGreaterThan(0);
  return (await calls(page, command))[0]!;
};

/** The soldier cursor mode on the map surface ("" without one). */
export const armyCursor = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>("[data-army-cursor]")?.dataset.armyCursor ?? "");

/** Field soldiers of the given types around a free point near home, a few world units apart. */
export const spawnSquad = (page: Page, types: readonly string[]) => page.evaluate(troops => {
  const simulation = (window as any).__settlement.simulation;
  const home = simulation.buildings().find((building: any) => building.typeId === 0);
  for (let ring = 6; ring <= 18; ring += 3) for (let step = 0; step < 12; step++) {
    const angle = step * Math.PI / 6;
    const centre = { x: home.access.x + Math.cos(angle) * ring, z: home.access.z + Math.sin(angle) * ring };
    const ids: number[] = [];
    for (const [index, type] of troops.entries()) {
      const point = { x: centre.x + (index - (troops.length - 1) / 2) * 2, z: centre.z };
      const spawned = simulation.spawnDebugSoldier(point, { rank: 0, type });
      if (!spawned) break;
      simulation.commandMilitary([spawned.id], point, "move");
      ids.push(spawned.id);
    }
    if (ids.length === troops.length) return { centre, ids };
    simulation.returnMilitaryHome(ids);
  }
  throw new Error("No room for the squad");
}, types);

export const removeSquad = (page: Page, ids: readonly number[]) => page.evaluate(soldiers => {
  const simulation = (window as any).__settlement.simulation;
  simulation.selectMilitary([]);
  simulation.returnMilitaryHome(soldiers);
}, ids);

/** The ids among `ids` that the simulation marks selected. */
const selectedOf = (page: Page, ids: readonly number[]) => page.evaluate(soldiers =>
  (window as any).__settlement.simulation.militarySoldiers()
    .filter((soldier: any) => soldiers.includes(soldier.actor) && soldier.combat?.selected)
    .map((soldier: any) => soldier.actor).sort((a: number, b: number) => a - b), ids);

/** Viewport chest points of the soldiers, after the rail (and with it Shift+drag) is live. */
const chestPoints = async (page: Page, ids: readonly number[], centre: { x: number; z: number }) => {
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".military-controls")?.hidden),
    "the soldier rail shows").toBe(false);
  await focusGround(page, centre.x, centre.z);
  return page.evaluate(soldiers => {
    const settlement = (window as any).__settlement;
    return soldiers.map(uid => {
      const actor = settlement.simulation.frames().find((entry: any) => entry.uid === uid);
      return settlement.project(actor.x, actor.y + .55, actor.z) as { x: number; y: number };
    });
  }, ids);
};

/** The viewport point of a ground point once the view stopped settling after a focus (two reads agree). */
const settledGround = async (page: Page, ground: { x: number; z: number }) => {
  const read = () => page.evaluate(([x, z]) => (window as any).__settlement.projectGround(x, z) as
    { x: number; y: number }, [ground.x, ground.z]);
  let previous = await read();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await read();
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < .3) return next;
    previous = next;
  }
  return previous;
};

/** Military controls P0/P1 (docs/plans/military-controls-research-2026-11-13.md §5, §6). */
test.describe("army smart right click", () => {
  test.beforeEach(({ game: { screen } }) => {
    test.skip(screen.width < PHONE_WIDTH, "mouse right click; phones order by long-press");
  });

  test("right-click an enemy fort besieges it; right-click the headquarters stores there", async ({ game }) => {
    const { page } = game;
    const scene = await createScene(page);
    try {
      await selectSoldier(page, scene.soldier);
      const siege = await rightClickBuilding(page, scene.fort, "siegeMilitary");
      expect(siege, "siege of the clicked fort with the selection").toEqual([[scene.soldier], scene.fort.uid]);
      await expect(page.locator(".army-order-marker")).toHaveAttribute("data-order", /attack|refused/);
      const fortPoint = await focusGround(page, scene.fort.x, scene.fort.z);
      await page.mouse.move(fortPoint.x + 2, fortPoint.y + 2);
      await page.mouse.move(fortPoint.x, fortPoint.y);
      await expect(page.locator(".hostile-building-tooltip"), "the shared hover pick shows the garrison tooltip")
        .toBeVisible();
      await expect.poll(() => armyCursor(page), "hovering the enemy fort with soldiers selected: siege cursor")
        .toBe("siege");
      await clearCalls(page);
      const store = await rightClickBuilding(page, scene.home, "returnMilitaryHome");
      expect(store, "return to the clicked storehouse").toEqual([[scene.soldier], scene.home.uid]);
    } finally {
      await removeScene(page, scene);
    }
  });

  test("a right tap or drag never turns the camera with the default Middle drag setting", async ({ game }) => {
    const { page } = game;
    const scene = await createScene(page);
    try {
      const before = await focusGround(page, scene.home.x, scene.home.z);
      await page.mouse.move(before.x + 40, before.y + 40);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(before.x + 43, before.y + 42);
      await page.mouse.move(before.x + 90, before.y + 60, { steps: 5 });
      await page.mouse.up({ button: "right" });
      await nextFrames(page);
      const after = await page.evaluate(([x, z]) => (window as any).__settlement.projectGround(x, z),
        [scene.home.x, scene.home.z]);
      // Only rounding noise of the ground sample: a rotation would move the point by many pixels.
      expect(Math.hypot(after.x - before.x, after.y - before.y), "the view did not rotate").toBeLessThan(.5);
      expect(await calls(page, "commandMilitary"), "no selection, no order").toEqual([]);
    } finally {
      await removeScene(page, scene);
    }
  });

  test("a right click during placement cancels the placement and sends no order", async ({ game }) => {
    const { page } = game;
    const scene = await createScene(page);
    try {
      await selectSoldier(page, scene.soldier);
      await clearCalls(page);
      const interacting = () => page.evaluate(() => (window as any).__settlement.isInteracting() as boolean);
      await page.evaluate(() => (window as any).__settlement.controls.selectRoad("dirt"));
      await expect.poll(interacting, "the dirt road tool is active").toBe(true);
      const point = await findMapPoint(page);
      await page.mouse.click(point.x, point.y, { button: "right" });
      await expect.poll(interacting, "the right click cancelled the road tool").toBe(false);
      for (const name of SPIED) expect(await calls(page, name), `${name}: no order`).toEqual([]);
    } finally {
      await removeScene(page, scene);
    }
  });
});

/** Military controls P2/P3: Shift+drag box, control groups and the double click on a troop type. */
test.describe("army selection", () => {
  test.beforeEach(({ game: { screen } }) => {
    test.skip(screen.width < PHONE_WIDTH, "mouse selection; phones use the rail's Box select");
  });

  test("Shift+drag box-selects without panning; Shift+1 assigns a group and 1 recalls it", async ({ game }) => {
    const { page } = game;
    const squad = await spawnSquad(page, ["shield", "shield", "archer"]);
    try {
      const chests = await chestPoints(page, squad.ids, squad.centre);
      const xs = chests.map(point => point.x), ys = chests.map(point => point.y);
      const before = await settledGround(page, squad.centre);
      await page.keyboard.down("Shift");
      await page.mouse.move(Math.min(...xs) - 30, Math.min(...ys) - 30);
      await page.mouse.down();
      await page.mouse.move(Math.max(...xs) + 30, Math.max(...ys) + 30, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await expect.poll(() => selectedOf(page, squad.ids), "the box selected the squad")
        .toEqual([...squad.ids].sort((a, b) => a - b));
      const after = await page.evaluate(([x, z]) => (window as any).__settlement.projectGround(x, z),
        [squad.centre.x, squad.centre.z]);
      // A pan would follow the whole drag (over 60 px); a pixel or two is the view settling.
      expect(Math.hypot(after.x - before.x, after.y - before.y), "Shift+drag did not pan").toBeLessThan(5);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Shift+Digit1");
      await expect(page.locator(".army-action-rail__group"), "the group badge").toHaveText("1·3");
      await page.keyboard.press("Escape");
      await expect.poll(() => selectedOf(page, squad.ids), "Escape cleared the selection").toEqual([]);
      await page.keyboard.press("Digit1");
      await expect.poll(() => selectedOf(page, squad.ids), "1 recalled the group").toHaveLength(3);
    } finally {
      await removeSquad(page, squad.ids);
    }
  });

  test("a double click on a soldier selects its troop type on screen", async ({ game }) => {
    const { page } = game;
    const squad = await spawnSquad(page, ["shield", "archer", "shield"]);
    try {
      const chests = await chestPoints(page, squad.ids, squad.centre);
      await page.mouse.dblclick(chests[0]!.x, chests[0]!.y);
      await expect.poll(() => selectedOf(page, squad.ids), "both shield soldiers, not the archer")
        .toEqual([squad.ids[0]!, squad.ids[2]!].sort((a, b) => a - b));
    } finally {
      await removeSquad(page, squad.ids);
    }
  });
});
