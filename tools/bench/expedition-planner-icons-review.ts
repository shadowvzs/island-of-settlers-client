import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "planner-icons"));
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const width of [1200, 390]) for (const theme of ["light", "dark"]) for (const kind of ["adventure", "colony"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390,
      isMobile: width === 390 });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); console.error(message.text()); } });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/planner-fixture.html", route => route.fulfill({ contentType: "text/html",
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><body></body>' }));
    await page.goto(`${url}planner-fixture.html`);
    await page.evaluate(async ({ kind, theme }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css"); await imp("/src/app/settlement-ui/index.ts");
      const [{ createSettlementUiStore }, windows, { COMMANDER_DEFINITIONS }] = await Promise.all([
        imp("/src/app/settlement-ui/ui-store.ts"),
        imp("/src/app/settlement-ui/expedition-planner/planner-window.ts"),
        imp("/src/shared/settlement/settlement-commander.ts")
      ]);
      document.documentElement.dataset.hudTheme = theme;
      document.body.style.background = "#677b6e";
      const root = document.createElement("main"); root.className = "settlement-ui";
      root.style.cssText = "position:fixed;inset:0;pointer-events:none"; document.body.append(root);
      const climates = ["swamp", "tropical", "desert", "winter", "forest"];
      const islands = climates.map((theme, id) => ({ theme, id, name: `${theme} island`, seed: id + 1,
        difficulty: ["easy", "medium", "hard"][id % 3], voyageSeconds: 90 + id * 20, size: 96,
        kind: "adventure", ore: "ironOre", resourceTier: id % 4 + 1, taken: id === 4 }));
      const commander = { aura: COMMANDER_DEFINITIONS.roman.aura, blockDetail: null, blockReason: null,
        canReturn: false, deckSlots: 2, definition: COMMANDER_DEFINITIONS.roman, developmentAllowed: false,
        healingSeconds: 0, healthReady: true, homeLodgeUid: 4, hp: 315, hpFraction: 1,
        id: "planner-commander", level: 3, location: "lodge", maximumHp: 315, name: "Aurelius", nation: "roman",
        nextThreshold: 100, ready: true, recoveryComplete: true, recoverySeconds: 0, xp: 45 };
      const store = createSettlementUiStore();
      store.update({ playerNation: "roman", commanders: [commander],
        colonyIslands: islands.map(({ kind, ...island }) => island),
        adventureIslands: islands.map(({ ore, resourceTier, taken, ...island }) => island),
        colonyTroops: { shield: 30, heavy: 20, archer: 20, cavalry: 0 } });
      const options = { onPlanAdventure: () => ({ loads: 1, seconds: 90, ships: 1, trips: 1 }),
        onPlanColony: () => ({ loads: 1, seconds: 90, ships: 1, trips: 1 }) };
      const open = kind === "colony" ? windows.createColonyPlannerWindow : windows.createAdventurePlannerWindow;
      const planner = open(store, options); root.append(planner.root); planner.openFor(5);
      (window as any).__plannerReview = { commander, store };
    }, { kind, theme });
    const planner = page.locator(".settlement-ui__colony-planner-window");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-${kind}-boot.png`) });
    await planner.locator("[data-colony-island]").first().waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>(".colony-planner img"))
      .every(image => image.complete && image.naturalWidth > 0));
    const cards = await planner.locator("[data-colony-island]").evaluateAll(elements => elements.map(element => {
      const button = element as HTMLButtonElement, rect = button.getBoundingClientRect();
      const art = button.firstElementChild!.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { climate: button.dataset.islandClimate, icon: button.querySelector("[data-icon]")?.getAttribute("data-icon"),
        difficulty: button.querySelector(".colony-planner__difficulty b")?.textContent,
        disabled: button.disabled, height: rect.height, hit: button.contains(hit), width: rect.width,
        artHeight: art.height, artWidth: art.width,
        wares: Array.from(button.querySelectorAll<HTMLImageElement>(".colony-planner__resources img"))
          .map(image => ({ loaded: image.complete && image.naturalWidth > 0, title: image.title, url: image.src })) };
    }));
    assert.equal(cards.length, 5);
    assert(cards.every(card => card.width >= 44 && card.width <= 96 &&
      Math.abs(card.width - card.height) <= 1 && card.artWidth <= 96 && card.artHeight <= 96),
    "New island icon buttons stay square and compact");
    assert.deepEqual(cards.map(card => card.icon), ["swamp", "tropical", "desert", "winter", "forest"].map(theme => `island-${theme}`));
    assert.deepEqual(cards.map(card => card.difficulty), ["1", "2", "3", "1", "2"]);
    assert(cards.filter(card => !card.disabled).every(card => card.hit), "decorative art must not intercept another card");
    if (kind === "colony") {
      assert(cards.every(card => card.wares.length === 2 && card.wares.every(ware => ware.loaded && ware.title)));
      assert.deepEqual(cards.slice(0, 4).map(card => card.wares.map(ware => ware.title)), [
        ["Hardwood logs", "Marble"], ["Cedar logs", "Limestone"], ["Walnut logs", "Basalt"], ["Mahogany logs", "Granite"]
      ]);
    } else assert(cards.every(card => card.wares.length === 0));
    await planner.screenshot({ path: resolve(output, `${width}-${theme}-${kind}.png`) });
    const first = planner.locator('[data-colony-island="0"]');
    await first.focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await planner.locator('[data-colony-island="1"]').getAttribute("aria-checked"), "true");
    await page.keyboard.press("End");
    const lastEnabled = cards.filter(card => !card.disabled).length - 1;
    assert.equal(await planner.locator(`[data-colony-island="${lastEnabled}"]`).getAttribute("aria-checked"), "true");
    await page.keyboard.press("Home"); assert.equal(await first.getAttribute("aria-checked"), "true");
    await page.keyboard.press("Escape"); assert(await planner.isVisible());
    if (width === 390) await first.tap(); else await first.click();
    const description = page.locator(`[id="${await first.getAttribute("aria-describedby")}"]`);
    await description.waitFor({ state: "visible" });
    assert.match(await description.innerText(), /swamp island/);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-${kind}-details.png`) });
    const owned = planner.locator('[data-commander-card="planner-commander"]');
    await owned.click(); assert.equal(await owned.getAttribute("aria-checked"), "true");
    const portrait = await owned.locator("img").first().getAttribute("src"); assert(portrait?.includes("commander-portraits"));
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const { commander, store } = (window as any).__plannerReview;
      store.update({ commanders: [{ ...commander, ready: false, blockReason: "away", location: "away" }] });
    });
    await page.waitForFunction(() => (document.querySelector('[data-commander-card="planner-commander"]') as HTMLButtonElement)?.disabled);
    await owned.locator("..").locator(".colony-planner__choice-info").click();
    const blockedDescription = page.locator(`[id="${await owned.getAttribute("aria-describedby")}"]`);
    await blockedDescription.waitFor({ state: "visible" }); assert.match(await blockedDescription.innerText(), /Away|away/);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-${kind}-unavailable.png`) });
    assert.deepEqual(errors, []);
    reports.push({ cards, errors, kind, portrait, theme, width });
    writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, scope: "Actual React windows on DOM-only fixture; no expedition launch or performance claim" }, null, 2));
    await context.close();
  }
} finally { await browser.close(); await server.close(); }
console.log(`Planner icon review: ${reports.length} desktop/phone theme/kind contexts`);
