import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectFocusInside, expectInsideViewport, nextFrames } from "../../fixtures/ui";

interface RaisedBuilding {
  uid: number;
  x: number;
  z: number;
}

/** Toolmaker (output select, pause, upgrade) and Armory (order steppers). */
const TOOLMAKER = 25, ARMORY = 24;

/** Development "build every building" fixture: one finished, road-connected building of the type. */
const raise = (page: Page, type: number) => page.evaluate((typeId): RaisedBuilding => {
  const result = (window as any).__settlement.simulation.debugRaiseBuilding(typeId);
  if (!result.ok) throw new Error(`Cannot raise ${typeId}: ${result.reason}`);
  return { uid: result.building.uid, x: result.building.x, z: result.building.z };
}, type);

const details = (page: Page) => page.locator(".settlement-ui__building-details-window");
const confirmWindow = (page: Page) => page.locator("[data-demolish-confirm]");
const closeDetails = (page: Page) =>
  page.getByRole("button", { exact: true, name: "Close building details window" }).click();

/**
 * Escape from inside the settlement UI closes every settlement window (main panel, register, details),
 * so the shared page is left as found (the main panel stays open after Menu > Buildings).
 */
const closeAll = async (page: Page) => {
  await page.locator(".settlement-ui__building-details-window .settlement-ui__drag-handle").focus();
  await page.keyboard.press("Escape");
  await expect(details(page)).toBeHidden();
};

/** Real map entry point: centre the camera on the building and click it. */
const openFromMap = async (page: Page, building: RaisedBuilding) => {
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), building);
  await nextFrames(page);
  const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), building);
  await page.mouse.click(screen.x, screen.y);
  await expect(details(page)).toBeVisible();
};

/** Menu > Buildings > the size tab > the type's card visits its completed building. */
const openFromRegister = async (
  page: Page, type: number, tab: "Small" | "Medium" | "Big" | "Mines"
) => {
  const buildings = page.getByRole("button", { exact: true, name: "Buildings" });
  if (!await buildings.isVisible()) await page.getByRole("button", { exact: true, name: "Menu" }).click();
  await buildings.click();
  await page.getByRole("tab", { exact: true, name: tab }).click();
  await page.locator(`[data-building-type="${type}"]`).click();
  await expect(details(page)).toBeVisible();
};

/** Waits for at least two 0.5 s snapshot ticks. */
const waitTicks = (page: Page) => page.waitForTimeout(1_200);

/** Wave 3a: building details (React sections) and the demolish confirmation. */
test.describe("building details", () => {
  let toolmaker: RaisedBuilding, armory: RaisedBuilding;

  test.beforeAll(async ({ game: { page } }) => {
    toolmaker = await raise(page, TOOLMAKER);
    armory = await raise(page, ARMORY);
    await waitTicks(page);
  });

  test.afterAll(async ({ game: { page } }) => {
    await page.evaluate(uids => {
      const simulation = (window as any).__settlement.simulation;
      for (const uid of uids) if (simulation.buildings().some((entry: any) => entry.uid === uid))
        simulation.demolishBuilding(uid);
    }, [toolmaker.uid, armory.uid]);
  });

  test("opens from a map click and the register, titled by the building, fits, Escape closes", async ({
    game: { page }
  }) => {
    await openFromMap(page, toolmaker);
    const window = details(page);
    const title = await window.locator("#settlement-building-details-title").innerText();
    expect(title, "title is the building name").not.toBe("Building details");
    await expect(page.getByRole("dialog", { exact: true, name: title })).toBeVisible();
    await expectFocusInside(window);
    await expectInsideViewport(page, window, true);
    await page.keyboard.press("Escape");
    await expect(window).toBeHidden();
    await openFromRegister(page, TOOLMAKER, "Medium");
    await expect(window.locator("#settlement-building-details-title")).toHaveText(title);
    await expect(page.locator(".settlement-ui__building-register-window")).toBeHidden();
    await closeDetails(page);
    await expect(window).toBeHidden();
    await page.getByRole("button", { exact: true, name: "Close settlement window" }).click();
  });

  test("controlled output radios keep focus and elements through snapshot ticks", async ({ game: { page } }) => {
    await openFromRegister(page, TOOLMAKER, "Medium");
    const select = details(page).getByRole("radio", { exact: true, name: "Produce axe" });
    await select.focus();
    await select.evaluate(element => { (element as HTMLInputElement & { marked?: boolean }).marked = true; });
    await waitTicks(page);
    await expect(select).toBeFocused();
    expect(await select.evaluate(element => (element as HTMLInputElement & { marked?: boolean }).marked),
      "same element after ticks").toBe(true);
    await select.check();
    await waitTicks(page);
    await expect(select).toBeChecked();
    await expect(select).toBeFocused();
    await details(page).getByRole("radio", { exact: true, name: "Produce random tools" }).check();
    await expect(details(page).getByRole("radio", { exact: true, name: "Produce random tools" })).toBeChecked();
    const output = details(page).getByRole("group", { exact: true, name: "Produced wares" });
    await expect(output.locator("[data-ware='randomTools']")).toHaveCount(1);
    await expect(output.locator("[data-ware='randomTools'] img")).toHaveCount(3);
    await closeAll(page);
  });

  test("an order stepper steps through its command and unlimited toggles back", async ({ game: { page } }) => {
    await openFromMap(page, armory);
    const row = details(page).locator('[data-production-ware="shield"]');
    const unlimited = row.getByRole("button", { exact: true, name: "Unlimited shield production" });
    const amount = row.getByLabel("Shield remaining", { exact: true });
    await expect(unlimited).toHaveAttribute("aria-pressed", "true");
    await unlimited.click();
    await expect(amount).toHaveText("0");
    await row.getByRole("button", { exact: true, name: "Produce one more shield" }).click();
    await row.getByRole("button", { exact: true, name: "Produce one more shield" }).click();
    await expect(amount).toHaveText("2");
    await row.getByRole("button", { exact: true, name: "Produce one fewer shield" }).click();
    await expect(amount).toHaveText("1");
    await unlimited.click();
    await expect(amount).toHaveText("∞");
    await closeAll(page);
  });

  test("storage pages and tools reset when another building is shown", async ({ game: { page } }) => {
    await openFromRegister(page, 0, "Big");
    const window = details(page);
    await expect(window.locator("[data-building-inventory]")).toBeVisible();
    const send = window.locator('[data-storage-tool="send"]');
    await send.click();
    await expect(send).toHaveAttribute("aria-pressed", "true");
    await window.locator("[data-storage-page-next]").click();
    await expect(window.locator(".settlement-ui__workforce-inventory img").first()).toBeVisible();
    await waitTicks(page);
    await expect(window.locator(".settlement-ui__workforce-inventory"), "page survives ticks").toBeVisible();
    await expectInsideViewport(page, window, true);
    // Phones: the details window covers the main panel, so close between visits.
    await closeAll(page);
    await openFromRegister(page, TOOLMAKER, "Medium");
    await closeAll(page);
    await openFromRegister(page, 0, "Big");
    await expect(window.locator("[data-building-inventory]"), "Resources page again").toBeVisible();
    await expect(window.locator('[data-storage-tool="receive"]')).toHaveAttribute("aria-pressed", "true");
    await closeAll(page);
  });

  test("HQ keeps one footer below a scrolling body and one action-icon size", async ({ game: { page } }) => {
    await openFromRegister(page, 0, "Big");
    const window = details(page), body = window.locator(".settlement-ui__building-details-body");
    const footer = window.locator(".settlement-ui__building-actions");
    await expect(body).toBeVisible();
    await expect(footer).toBeVisible();
    const bodyBox = await body.boundingBox(), footerBox = await footer.boundingBox(), windowBox = await window.boundingBox();
    expect(bodyBox && footerBox && windowBox).toBeTruthy();
    expect(bodyBox!.y + bodyBox!.height, "wares stop above the footer").toBeLessThanOrEqual(footerBox!.y + 1);
    expect(footerBox!.y + footerBox!.height, "footer stays inside the window").toBeLessThanOrEqual(windowBox!.y + windowBox!.height + 1);
    const sizes = await footer.locator(".settlement-ui__button > :is(svg, img).settlement-art-icon").evaluateAll(nodes =>
      nodes.map(node => {
        const style = getComputedStyle(node);
        return `${style.width} ${style.height}`;
      }));
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sizes)).toEqual(new Set(["30px 30px"]));
    await window.locator("[data-storage-page-next]").click();
    await expect(window.locator(".settlement-ui__workforce-inventory")).toBeVisible();
    await expect(footer, "the footer stays put across the register's two pages").toBeVisible();
    const nextBody = await body.boundingBox(), nextFooter = await footer.boundingBox();
    expect(nextBody!.y + nextBody!.height).toBeLessThanOrEqual(nextFooter!.y + 1);
    await closeAll(page);
  });

  test("HQ and storehouse footers share one action-button footprint", async ({ game: { page } }) => {
    const raised: RaisedBuilding[] = [];
    try {
      for (const type of [0, 29]) {
        if (type !== 0) raised.push(await raise(page, type));
        await openFromRegister(page, type, type === 0 ? "Big" : "Medium");
        const footer = details(page).locator(".settlement-ui__building-actions");
        await expect(footer).toBeVisible();
        const boxes = await footer.getByRole("button").evaluateAll(nodes =>
          nodes.map(node => {
            const box = node.getBoundingClientRect();
            return `${Math.round(box.width)}x${Math.round(box.height)}`;
          }));
        expect(boxes.length, `type ${type} footer actions`).toBeGreaterThanOrEqual(4);
        expect(new Set(boxes), `type ${type} consistent action buttons`).toEqual(new Set(["48x56"]));
        await closeAll(page);
      }
    } finally {
      await page.evaluate(entries => {
        const simulation = (window as any).__settlement.simulation;
        for (const entry of entries)
          if (simulation.buildings().some((building: any) => building.uid === entry.uid))
            simulation.demolishBuilding(entry.uid);
      }, raised);
    }
  });

  test("upgrade action tooltip and confirmation preserve the building window", async ({ game: { page } }) => {
    await openFromRegister(page, TOOLMAKER, "Medium");
    const window = details(page);
    const info = window.getByRole("button", { exact: true, name: "Upgrade" });
    const tooltip = window.getByRole("tooltip");
    await info.hover();
    await expect(tooltip).toBeVisible();
    await expectInsideViewport(page, tooltip);
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();
    await info.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(window, "Escape only closed the tooltip").toBeVisible();
    if (await info.getAttribute("aria-disabled") === "true") {
      await info.click({ force: true });
      await expect(tooltip, "the unavailable action still explains its benefits").toBeVisible();
      await expectInsideViewport(page, tooltip);
    } else {
      await info.click();
      const confirmation = page.getByRole("alertdialog", { exact: true, name: "Confirm building upgrade" });
      await expect(confirmation).toBeVisible();
      const actions = confirmation.locator(".settlement-popup__actions");
      const actionButtons = actions.getByRole("button");
      await expect(actionButtons).toHaveCount(2);
      await expect(actionButtons.nth(0)).toHaveAccessibleName("Upgrade");
      await expect(actionButtons.nth(1)).toHaveAccessibleName("Close");
      await expect(actionButtons.nth(0)).toBeFocused();
      expect(await actions.evaluate(element => getComputedStyle(element).gap)).toBe("16px");
      const upgradeCard = confirmation.locator(".settlement-ui__upgrade");
      const benefits = upgradeCard.locator(".settlement-ui__upgrade-actions");
      expect(await upgradeCard.evaluate(element => getComputedStyle(element).position)).toBe("relative");
      expect(await benefits.evaluate(element => getComputedStyle(element).position)).toBe("absolute");
      expect(await benefits.evaluate(element => [getComputedStyle(element).top, getComputedStyle(element).right]))
        .toEqual(["8px", "8px"]);
      await expectInsideViewport(page, confirmation);
      await confirmation.getByRole("button", { exact: true, name: "Close" }).click();
      await expect(confirmation).toBeHidden();
      await expect(info).toBeFocused();
    }
    await window.locator("#settlement-building-details-title").click();
    await expect(tooltip, "a press outside closes it").toBeHidden();
    await closeAll(page);
  });

  test("demolish asks first: Escape, outside press and Keep cancel, Demolish removes", async ({
    game: { page }
  }) => {
    for (const building of [armory, toolmaker]) {
      await openFromMap(page, building);
      const demolish = details(page).locator(`[data-demolish-building="${building.uid}"]`);
      await demolish.click();
      const keep = confirmWindow(page).locator(`[data-demolish-confirm-no="${building.uid}"]`);
      await expect(keep).toBeFocused();
      await expectInsideViewport(page, confirmWindow(page));
      await page.keyboard.press("Escape");
      await expect(confirmWindow(page)).toBeHidden();
      await expect(details(page), "Escape only cancelled the question").toBeVisible();
      await demolish.click();
      await expect(keep).toBeFocused();
      await details(page).locator("#settlement-building-details-title").click();
      await expect(confirmWindow(page), "a press outside cancels").toBeHidden();
      await demolish.click();
      await keep.click();
      await expect(confirmWindow(page)).toBeHidden();
      await demolish.click();
      await confirmWindow(page).locator(`[data-demolish-confirm-yes="${building.uid}"]`).click();
      await expect(confirmWindow(page)).toBeHidden();
      await expect(details(page), "demolishing closes the details").toBeHidden();
      expect(await page.evaluate(uid => (window as any).__settlement.simulation.buildings()
        .some((entry: any) => entry.uid === uid), building.uid)).toBe(false);
    }
  });
});
