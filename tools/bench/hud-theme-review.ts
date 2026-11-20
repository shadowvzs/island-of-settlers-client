import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/hud-themes");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(),
  browser = await launchBrowser();
const reports: unknown[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
/** Corner icon buttons share one 40 px footprint; the popover options are the touch targets. */
const MIN_CORNER_ICON = 40;
const pickMode = async (page: Page, mode: string) => {
  await page.locator(".hud-theme-toggle").click();
  await page.locator(`[data-hud-mode="${mode}"]`).click();
  await page.keyboard.press("Escape");
};
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await page.addInitScript(() => {
      (window as any).__name = (value: unknown) => value;
    });
    await page.goto(`${url}?quality=${quality}&seed=123&reveal=1&cache=0`);
    await page.waitForFunction(
      () => Boolean((window as any).__islandReady && (window as any).__settlement),
      null,
      { timeout: 120000 }
    );
    // The settlement HUD's React content loads right after the island is shown.
    await page.locator(".settlement-ui__actions > button").nth(3).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-hud-theme"), "light");
    assert.equal(await page.locator(".hud-theme-toggle").getAttribute("aria-pressed"), "false");
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
      { width: 844, height: 390 }
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"]) {
        await pickMode(page, theme);
        assert.equal(await page.locator("html").getAttribute("data-hud-theme"), theme);
        const button = await page.locator(".hud-theme-toggle").boundingBox();
        assert(
          button &&
            button.width >= MIN_CORNER_ICON &&
            button.height >= MIN_CORNER_ICON &&
            button.x >= 0 &&
            button.x + button.width <= viewport.width
        );
        assert.equal(
          await page.locator(".hud-theme-toggle").getAttribute("aria-pressed"),
          String(theme === "dark")
        );
        assert.equal(
          await page.locator(`[data-hud-mode="${theme}"]`).getAttribute("aria-checked"),
          "true"
        );
        assert.deepEqual(
          await page
            .locator(".settlement-ui__actions > button")
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
          ["Build", "Map", "Menu", "News"]
        );
        assert.equal((await page.locator(".settlement-ui__bar").textContent())?.trim(), "");
        await page.getByRole("button", { name: "Build", exact: true }).click();
        const surfaces = await page
          .locator(".settlement-ui__bar,.settlement-ui__panel:not([hidden], .settlement-popup__dialog),.settlement-ui__status")
          .evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element);
              return {
                ink: style.color,
                paper: style.backgroundColor,
                texture: style.backgroundImage
              };
            })
          );
        assert(surfaces.length >= 2);
        // The palette's ink token, resolved to rgb() through a probe element.
        const ink = await page.evaluate(() => {
          const probe = document.body.appendChild(document.createElement("span"));
          probe.style.color = "var(--hud-ink)";
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        });
        assert(surfaces.every((surface) => surface.ink === ink), JSON.stringify(surfaces.map((s) => s.ink)));
        assert(
          surfaces.every((surface) => surface.texture.includes("feTurbulence")),
          JSON.stringify(surfaces.map((surface) => surface.texture.slice(0, 80)))
        );
        const readability = await page
          .locator(".settlement-ui__panel:not([hidden], .settlement-popup__dialog)")
          .evaluate((panel) => {
            const rgb = (value: string) =>
              value
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number);
            const linear = (value: number) =>
              value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
            const luminance = (color: number[]) =>
              color
                .map(linear)
                .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
            const contrast = (a: number[], b: number[]) => {
              const first = luminance(a),
                second = luminance(b);
              return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
            };
            const paper = rgb(getComputedStyle(panel).backgroundColor);
            return Array.from(
              panel.querySelectorAll(
                "h2,.settlement-ui__card > span,.settlement-ui__card small,.settlement-ui__tab"
              )
            ).map((element) => {
              const style = getComputedStyle(element);
              const card = element.closest(".settlement-ui__card,.settlement-ui__tab");
              const gradient = card
                ? // The opaque control gradient is the last layer, under translucent sheen and grain.
                  getComputedStyle(card).backgroundImage.split("linear-gradient(").at(-1)!
                    .match(/rgba?\([^)]*\)/)?.[0]
                : undefined;
              const background = gradient ? rgb(gradient) : paper;
              return { text: element.textContent, ratio: contrast(rgb(style.color), background) };
            });
          });
        assert(
          readability.every((sample) => sample.ratio >= 4.5),
          `${theme} ink must have readable contrast: ${JSON.stringify(readability.filter((sample) => sample.ratio < 4.5))}`
        );

        await page.screenshot({
          path: resolve(output, `${quality}-${theme}-build-${viewport.width}.png`)
        });
        await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
        await page
          .locator(".settlement-ui__bar")
          .getByRole("button", { name: "Map", exact: true })
          .click();
        await page.screenshot({
          path: resolve(output, `${quality}-${theme}-map-${viewport.width}.png`)
        });
        await page
          .locator(".settlement-ui__bar")
          .getByRole("button", { name: "Map", exact: true })
          .click();
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        // Settings closes the menu window itself.
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        const panel = await page.locator(".settings-panel:not([hidden])").boundingBox();
        assert(
          panel &&
            panel.x >= 0 &&
            panel.y >= 0 &&
            panel.x + panel.width <= viewport.width &&
            panel.y + panel.height <= viewport.height
        );
        await page.screenshot({
          path: resolve(output, `${quality}-${theme}-settings-${viewport.width}.png`)
        });
        await page.getByRole("button", { name: "Close settings panel", exact: true }).click();
        await page.getByRole("button", { name: "News", exact: true }).click();
        await page.screenshot({
          path: resolve(output, `${quality}-${theme}-news-${viewport.width}.png`)
        });
        await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
        reports.push({
          quality,
          theme,
          viewport,
          touchButton: button,
          surfaces,
          readability,
          errors
        });
      }
    }
    assert.equal(
      await page.evaluate(() => localStorage.getItem("island-of-settlers.hud-paper-theme")),
      "dark"
    );
    await page.reload();
    await page.waitForFunction(
      () => Boolean((window as any).__islandReady && (window as any).__settlement),
      null,
      { timeout: 120000 }
    );
    await page.locator(".settlement-ui__actions > button").nth(3).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-hud-theme"), "dark");
    assert.equal(await page.locator(".hud-theme-toggle").getAttribute("aria-pressed"), "true");
    await pickMode(page, "light");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("island-of-settlers.hud-paper-theme")),
      "light"
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ reports, errors: [] }, null, 2));
  console.log(
    `Light/dark papyrus: both LODs, desktop/portrait/landscape, four unchanged launchers and persisted preference passed; ${output}`
  );
} finally {
  await browser.close();
  await server.close();
}
