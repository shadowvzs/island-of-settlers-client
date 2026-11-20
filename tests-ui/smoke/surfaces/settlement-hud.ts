import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectInsideViewport, expectKeyboardMove, nextFrames, PHONE_WIDTH } from "../../fixtures/ui";

/**
 * Wave 3c / 5: the settlement HUD React root (loaded after the island is shown): bottom launchers,
 * the main panel and its exclusive views, the road toolbar and building picker, the placement strip,
 * the status toast and the player corner. Rows, labels and markup are vitest (`settlement-hud`).
 */
const mainPanel = (page: Page) => page.locator('[aria-labelledby="settlement-panel-title"]');
const launcher = (page: Page, name: string) =>
  page.locator(".settlement-ui__bar").getByRole("button", { exact: true, name });
const placement = (page: Page) => page.locator(".settlement-ui__placement");

const openBuild = async (page: Page) => {
  await launcher(page, "Build").click();
  await expect(page.getByRole("heading", { exact: true, name: "Build your settlement" })).toBeVisible();
};

const boxesOverlap = async (first: Locator, second: Locator) => {
  const [a, b] = [(await first.boundingBox())!, (await second.boundingBox())!];
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
};

test.describe("settlement HUD", () => {
  test("launchers, Build focus, category keys, road tool toggle, Escape back to Build", async ({ game }) => {
    const { page } = game;
    expect(await page.locator(".settlement-ui__actions > button").evaluateAll(buttons =>
      buttons.map(button => button.getAttribute("aria-label")))).toEqual(["Build", "Map", "Menu", "News"]);
    await expect(page.locator(".settlement-ui__bar")).toHaveText("");
    await expectInsideViewport(page, page.locator(".settlement-ui__bar"));
    await openBuild(page);
    const panel = mainPanel(page);
    await expectInsideViewport(page, panel);
    const tabs = page.getByRole("tablist", { exact: true, name: "Building categories" }).getByRole("tab");
    await expect(tabs.nth(0)).toHaveText("Roads");
    await expect(tabs.nth(1)).toHaveText("Small");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toBeFocused();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    const roadImages = panel.locator("[data-road] img");
    await expect(roadImages).toHaveCount(6);
    await expect.poll(() => roadImages.evaluateAll(images => images.every(image =>
      image instanceof HTMLImageElement && image.complete && image.naturalWidth >= 192))).toBe(true);
    await panel.screenshot({ path: test.info().outputPath("roads-menu.png") });
    const dirt = page.getByRole("button", { exact: true, name: "Dirt road" });
    await dirt.click();
    await expect(dirt).toHaveAttribute("aria-pressed", "true");
    await expect(placement(page)).toContainText("Build dirt road");
    await expect(placement(page).getByRole("button", { name: "Rotate selected building" })).toHaveCount(0);
    const granite = page.getByRole("button", { exact: true, name: "Granite road" });
    await expect(granite).toHaveAttribute("aria-disabled", "true");
    await granite.click({ force: true });
    await expect(page.locator(".settlement-ui__selection-detail")).toContainText("Requires level 46");
    await expect(dirt).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { exact: true, name: "Stone road" }).click();
    await expect(dirt).toHaveAttribute("aria-pressed", "false");
    await expect(placement(page)).toContainText("Stone road upgrade");
    await page.keyboard.press("Escape");
    await expect(placement(page), "Escape cancels the tool first").toBeHidden();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(launcher(page, "Build")).toBeFocused();
  });

  test("picking a building shows the placement strip; phones hide the picker; Cancel ends it", async ({ game }) => {
    const { page } = game;
    await openBuild(page);
    // The panel keeps the last category (the previous test ends on Roads).
    await page.getByRole("tablist", { exact: true, name: "Building categories" })
      .getByRole("tab", { exact: true, name: "Small" }).click();
    await page.locator("[data-building='17']").click();
    await expect(placement(page)).toContainText("Place Woodcutter");
    await expect(placement(page).getByRole("button", { name: "Rotate selected building" })).toBeVisible();
    await expectInsideViewport(page, placement(page));
    if (game.screen.width < 640) await expect(mainPanel(page), "phones make room for the map").toBeHidden();
    else await expect(page.locator("[data-building='17']")).toHaveAttribute("aria-pressed", "true");
    await placement(page).getByRole("button", { exact: true, name: "Cancel placement or road tool" }).click();
    await expect(placement(page)).toBeHidden();
  });

  test("Menu keeps automatic saving and Export / Import out of the way while offering window shortcuts",
    async ({ game }) => {
      const { page } = game;
      await launcher(page, "Menu").click();
      const panel = mainPanel(page);
      await expect(panel.getByRole("button", { exact: true, name: "Export game" })).toHaveCount(0);
      await expect(panel.getByRole("button", { exact: true, name: "Import game" })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^(Save game|Load game|Save now)$/ })).toHaveCount(0);
      await expect(panel.getByRole("button", { exact: true, name: "Language" })).toBeVisible();
      await expectInsideViewport(page, panel);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

  test("Overview separates goods from settlers, workers and military units", async ({ game }) => {
    const { page } = game;
    await launcher(page, "Menu").click();
    await mainPanel(page).getByRole("button", { exact: true, name: "Overview" }).click();
    const overview = page.getByRole("dialog", { exact: true, name: "Settlement overview" });
    await expect(overview).toBeVisible();
    const tabs = overview.getByRole("tablist", { name: "Settlement overview sections" }).getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText("Goods");
    await expect(tabs.nth(1)).toHaveText("Settlers");
    await expect(overview.locator(".settlement-ui__counters")).toHaveCount(0);
    await expect(overview.locator(".settlement-ui__resources")).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Settlers" })).toBeHidden();
    await tabs.nth(1).click();
    await expect(overview.getByRole("heading", { name: "Settlers" })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Workers" })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Military units" })).toBeVisible();
    await expect(overview.locator(".settlement-ui__resources")).toBeHidden();
    await expectInsideViewport(page, overview);
    await page.keyboard.press("Escape");
  });

  test("Menu, Ships and News are exclusive views; close button and Escape refocus Build", async ({ game }) => {
    const { page } = game;
    const panel = mainPanel(page);
    await launcher(page, "Menu").click();
    await expect(page.getByRole("dialog", { exact: true, name: "Main selection" })).toBeVisible();
    await expectKeyboardMove(page, panel, panel.getByRole("button", {
      exact: true, name: "Move settlement window. Drag or use arrow keys."
    }));
    await panel.getByRole("button", { exact: true, name: "Ships" }).click();
    await expect(page.getByRole("dialog", { exact: true, name: "Fleet" })).toBeVisible();
    await expect(panel.getByRole("button", { exact: true, name: "Overview" }), "menu view hidden").toBeHidden();
    await expect(panel.locator(".settlement-ui__fleet")).toContainText("Your fleet");
    await launcher(page, "News").click();
    await expect(page.getByRole("dialog", { exact: true, name: "Notifications" })).toBeVisible();
    await expect(panel).toContainText("News from your settlement.");
    await expectInsideViewport(page, panel);
    await panel.getByRole("button", { exact: true, name: "Close settlement window" }).click();
    await expect(panel).toBeHidden();
    await expect(launcher(page, "Build")).toBeFocused();
    await launcher(page, "News").click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(launcher(page, "Build")).toBeFocused();
  });

  test("survey actions leave the building menu and Remove road lives inside Roads", async ({ game }) => {
    const { page } = game;
    await openBuild(page);
    const panel = mainPanel(page);
    await panel.getByRole("tab", { exact: true, name: "Small" }).click();
    await expect(panel.getByRole("button", { exact: true, name: "Geologist" })).toHaveCount(0);
    await expect(panel.getByRole("button", { exact: true, name: "Scout" })).toHaveCount(0);
    await expect(panel.getByRole("button", { exact: true, name: "Remove road" })).toBeHidden();
    await panel.getByRole("tab", { exact: true, name: "Roads" }).click();
    await panel.getByRole("button", { exact: true, name: "Remove road" }).click();
    await expect(placement(page)).toContainText("Remove road section");
    await page.keyboard.press("Escape");
  });

  test("player corner: animated portrait, XP bar toggles and remembers it, gems open the shop", async ({ game }) => {
    const { page } = game;
    const hud = page.locator(".player-hud");
    const portrait = hud.locator(".player-hud__portrait");
    const phonePortrait = game.screen.width <= PHONE_WIDTH;
    if (phonePortrait) {
      // HUD-PORTRAIT-01: phone portrait removes the avatar; the quest actions keep its click target.
      await expect(portrait).toBeHidden();
    } else {
      await expect(portrait).toBeVisible();
      const size = await portrait.evaluate(element => element.getBoundingClientRect().width * devicePixelRatio);
      expect(Math.abs(size - Math.round(size)), "portrait snapped to device pixels").toBeLessThan(0.01);
      const frame = () => portrait.evaluate(element => element.style.getPropertyValue("--portrait-column"));
      const first = await frame();
      await expect.poll(frame, { message: "the sprite sheet steps at 12 fps" }).not.toBe(first);
    }
    await expect(hud.getByRole("button", { name: /^Quests(:|$)/ })).toBeVisible();
    const covered = await page.evaluate(selectors => selectors.filter(selector => {
      const button = document.querySelector(selector)!;
      const box = button.getBoundingClientRect();
      return !button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), [
      ...(phonePortrait ? [] : [".player-hud__portrait"]),
      ".player-hud__gems", ".player-hud__quests", ".settlement-ui__button--primary"
    ]);
    expect(covered, "no canvas or layer above the HUD buttons").toEqual([]);
    await expect(hud.getByRole("button", { name: /^Messages/ })).toBeVisible();
    const experience = hud.locator(".player-hud__experience");
    await experience.click();
    await expect(hud).toHaveClass(/is-portrait-hidden/);
    await expect(experience).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("island-of-settlers.portrait-hidden"))).toBe("1");
    await experience.click();
    await expect(hud).not.toHaveClass(/is-portrait-hidden/);
    await hud.getByRole("button", { exact: true, name: "Gems: open the gem shop" }).click();
    const shop = page.getByRole("dialog", { exact: true, name: "Gem shop" });
    await expect(shop).toBeVisible();
    await shop.getByRole("button", { exact: true, name: "Close gem shop window" }).click();
  });

  test("BUG-02: the counters never cover the theme toggle, with or without the portrait", async ({ game }) => {
    const { page } = game;
    const toggle = page.locator(".hud-theme-toggle");
    const counters = [page.locator(".player-hud__experience"), page.locator(".player-hud__gems")];
    const experience = counters[0]!;
    for (const portraitHidden of [false, true]) {
      if (portraitHidden) await experience.click();
      for (const counter of counters) expect(await boxesOverlap(toggle, counter), "counter clear of the toggle").toBe(false);
      const hit = await toggle.evaluate(button => {
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      });
      expect(hit, "a tap on the toggle reaches it").toBe(true);
    }
    await experience.click();
    if (game.screen.width <= PHONE_WIDTH) await expectInsideViewport(page, page.locator(".player-hud__counters"));
  });

  test("HUD-PORTRAIT-01: phone corner controls never overlap or overflow from 320 to 480 px", async ({ game }) => {
    test.skip(game.screen.width > PHONE_WIDTH, "phone portrait layout");
    const { page } = game;
    const hud = page.locator(".player-hud");
    await expect(hud.locator(".player-hud__portrait")).toBeHidden();
    await expect(hud.locator(".player-hud__population")).toBeHidden();
    await expect(hud.locator(".player-hud__experience")).toBeVisible();
    await expect(hud.locator(".player-hud__gems")).toBeVisible();
    await expect(hud.locator(".player-hud__exploration")).toBeVisible();
    await expect(hud.locator(".player-hud__quest-actions button")).toHaveCount(3);

    const readBoxes = () => page.evaluate(() => {
      const selectors = [
        ".player-hud__experience",
        ".player-hud__gems",
        ".player-hud__population",
        ".player-hud__exploration",
        ".player-hud__portrait",
        ".settings__buttons .settings__icon",
        ".player-hud__quest-actions button"
      ];
      return selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)))
        .map(element => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            height: box.height,
            label: element.getAttribute("aria-label") ?? element.className,
            visible: style.display !== "none" && style.visibility !== "hidden" &&
              box.width > 0 && box.height > 0,
            width: box.width,
            x: box.x,
            y: box.y
          };
        })
        .filter(box => box.visible);
    });
    const assertLayout = async (width: number) => {
      const boxes = await readBoxes();
      for (let first = 0; first < boxes.length; first++) {
        const a = boxes[first]!;
        expect(a.x, `${a.label} starts inside ${width}px`).toBeGreaterThanOrEqual(0);
        expect(a.y, `${a.label} starts below the top edge`).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width, `${a.label} ends inside ${width}px`).toBeLessThanOrEqual(width + 1);
        expect(a.y + a.height, `${a.label} stays above the bottom edge`).toBeLessThanOrEqual(845);
        for (let second = first + 1; second < boxes.length; second++) {
          const b = boxes[second]!;
          const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
            a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlap, `${a.label} overlaps ${b.label} at ${width}px`).toBe(false);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    };

    for (const width of [320, 360, 390, 430, 480]) {
      await page.setViewportSize({ height: 844, width });
      await nextFrames(page);
      await assertLayout(width);
    }

    // Long/localized counter copy must not push a sibling under the top-right settings strip.
    await page.setViewportSize({ height: 844, width: 320 });
    await nextFrames(page);
    const experienceText = hud.locator(".player-hud__experience-body small");
    const originalText = await experienceText.textContent();
    await experienceText.evaluate(element => { element.textContent = "0 / 123 456 789 000 XP"; });
    await nextFrames(page);
    await assertLayout(320);
    await experienceText.evaluate((element, text) => { element.textContent = text; }, originalText);

    // Rotating out and back restores the landscape avatar/population, then the phone stack.
    await page.setViewportSize({ height: 390, width: 844 });
    await nextFrames(page);
    await expect(hud.locator(".player-hud__portrait")).toBeVisible();
    await expect(hud.locator(".player-hud__population")).toBeVisible();
    await expectInsideViewport(page, hud.locator(".player-hud__counters"));
    await page.setViewportSize(game.screen);
    await nextFrames(page);
    await expect(hud.locator(".player-hud__portrait")).toBeHidden();
    await expect(hud.locator(".player-hud__population")).toBeHidden();
    await assertLayout(390);
  });
});
