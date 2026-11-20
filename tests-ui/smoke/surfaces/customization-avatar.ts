import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { openMainSelection } from "../../fixtures/ui";

const customization = (page: Page) => page.getByRole("dialog", { exact: true, name: "Customization" });
const hudPortrait = (page: Page) => page.locator(".player-hud__portrait");
const explorationUi = (page: Page) => page.locator('[data-testid="exploration-ui"]');

const openCustomization = async (page: Page) => {
  const main = await openMainSelection(page);
  await main.getByRole("button", { exact: true, name: "Customization" }).click();
  await expect(customization(page)).toBeVisible();
  return customization(page);
};

const portraitImage = (page: Page) => hudPortrait(page).evaluate(element =>
  getComputedStyle(element).backgroundImage);

const chooseGender = async (page: Page, gender: "female" | "male") => {
  const window = customization(page);
  const radio = window.locator(`[data-gender="${gender}"]`);
  await expect(radio).toBeEnabled();
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => portraitImage(page)).toContain(`-${gender}.webp`);
};

const chooseNation = async (page: Page, nation: "nubian" | "roman" | "viking" | "japanese") => {
  const window = customization(page);
  const button = window.locator(`[data-nation="${nation}"]`);
  await button.click();
  await expect(button).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => portraitImage(page), { timeout: 30_000 }).toContain(`${nation}-`);
};

const enterPossession = async (page: Page) => {
  await page.getByRole("button", { exact: true, name: "Close customization window" }).click();
  await expect(customization(page)).toBeHidden();
  await page.locator('[data-exploration-entry="true"]').click();
  await expect(explorationUi(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() =>
    (window as any).__exploration?.controller.phase()), { timeout: 30_000 }).toBe("possessed");
};

/** AVATAR-01 and EXPLORE-APPEARANCE-01: the customization choice reaches the HUD and possession. */
test.describe("customization avatar", () => {
  test("male/female faces update the HUD and the possessed explorer after a nation change", async ({
    game: { page }
  }) => {
    const window = await openCustomization(page);
    await expect(window.getByRole("radiogroup", { name: "Gender", exact: true })).toBeVisible();
    await expect(window.locator(".customization__face")).toHaveCount(2);
    await chooseGender(page, "female");
    expect(await portraitImage(page)).toContain("roman-female.webp");
    await chooseNation(page, "viking");
    expect(await portraitImage(page)).toContain("viking-female.webp");
    await chooseGender(page, "male");
    expect(await portraitImage(page)).toContain("viking-male.webp");
    await enterPossession(page);
    await expect(page.locator(".exploration-ui__notice")).toHaveCount(0);
    await page.screenshot({
      path: "../resources/project-reviews/avatar-2026-10-27/"
        + `${test.info().project.name}-viking-male-possession.png`
    });
    await page.locator(".exploration-ui__leave").click();
    await expect.poll(() => page.evaluate(() =>
      (window as any).__exploration?.controller.phase()), { timeout: 30_000 }).not.toBe("possessed");
    await openCustomization(page);
    await chooseNation(page, "roman");
    await chooseGender(page, "male");
    await page.getByRole("button", { exact: true, name: "Close customization window" }).click();
  });
});
