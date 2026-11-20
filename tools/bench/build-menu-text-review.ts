import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

// Real BuildView / native asset layout. No world simulation or claimed GPU-quality comparison.
const output = resolve(process.env.BUILD_MENU_REVIEW_OUTPUT ?? "../resources/build-menu-text-review");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const width of [1200, 390]) for (const nation of ["roman", "viking", "japanese", "nubian"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/build-text-review.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}build-text-review.html`);
    await page.evaluate(async nation => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css");
      await imp("/src/app/settlement-ui/index.ts");
      const fixture = await imp("/tools/bench/build-menu-text-fixture.tsx") as
        typeof import("./build-menu-text-fixture");
      fixture.mountBuildMenuTextReview(nation);
    }, nation);
    for (const theme of ["light", "dark"]) for (const level of [1, 56]) {
      await page.evaluate(theme => { document.documentElement.dataset.hudTheme = theme; }, theme);
      await page.evaluate(level => (window as any).__buildTextReview(level), level);
      for (const tab of ["Roads", "Small", "Medium", "Big", "Mines"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await page.locator(".settlement-ui__cards img").evaluateAll(async images => {
          await Promise.all(images.filter(image => image.getBoundingClientRect().width > 0).map(image => {
            (image as HTMLImageElement).loading = "eager";
            return (image as HTMLImageElement).decode();
          }));
        });
        const cards = await page.locator(".settlement-ui__cards > button:not([hidden])").evaluateAll(elements =>
          elements.filter(element => element.getBoundingClientRect().width > 0).map(element => {
            const name = element.querySelector<HTMLElement>(".settlement-ui__build-card-name")!;
            const rect = name.getBoundingClientRect(), card = element.getBoundingClientRect();
            const lock = element.querySelector(".settlement-ui__card-lock")?.getBoundingClientRect();
            return { name: name.innerText, width: rect.width, height: rect.height,
              color: getComputedStyle(name).color, opacity: getComputedStyle(name).opacity,
              fontSize: getComputedStyle(name).fontSize, lineHeight: getComputedStyle(name).lineHeight,
              verticalOverflow: name.scrollHeight > name.clientHeight + 1,
              horizontalOverflow: name.scrollWidth > name.clientWidth + 1,
              outsideCard: rect.left < card.left || rect.right > card.right + 1,
              lockOverlap: Boolean(lock && lock.bottom > rect.top && lock.top < rect.bottom && lock.left < rect.right),
              unloadedImages: [...element.querySelectorAll("img")].filter(image => !image.complete || !image.naturalWidth).length };
          }));
        reports.push({ cards, errors, level, nation, tab, theme, width });
        assert(cards.length > 0);
        assert(cards.every(card => !card.horizontalOverflow && !card.verticalOverflow && !card.outsideCard && !card.lockOverlap && !card.unloadedImages),
          `${nation} ${width} level ${level} ${tab}: text/image metrics`);
        await page.locator(".settlement-ui__panel").screenshot({ path: resolve(output, `${nation}-${width}-${theme}-${level}-${tab}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
  await browser.close();
  await server.close();
}
