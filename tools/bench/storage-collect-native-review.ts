import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "storage-collect-ui");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports = [];
try {
  for (const [width, locale] of [[1200, "en"], [390, "hu"]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/storage-collect.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}storage-collect.html`);
    await page.evaluate(async locale => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css"); await imp("/src/app/settlement-ui/index.ts");
      const { languagePreference } = await imp("/src/app/localization/language-store.ts");
      languagePreference.setLanguage(locale);
      await languagePreference.ready();
      const { createBuildingDetailsMount } = await imp("/src/app/settlement-ui/building-details/mount.tsx");
      const { createSettlementUiStore } = await imp("/src/app/settlement-ui/ui-store.ts");
      const { createExternalStore } = await imp("/src/app/components/ui-store.ts");
      const root = document.createElement("div"); root.className = "settlement-ui";
      const panel = document.createElement("section"); panel.className = "settlement-ui__panel";
      panel.style.cssText = "left:10px;top:10px;bottom:auto;width:min(480px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto";
      root.append(panel); document.body.append(root); document.body.style.background = "#647954";
      const store = createSettlementUiStore(), wares: string[] = [], calls: unknown[] = [];
      let focused = "0", visible = false, available = true, unavailableWares: string[] = [];
      const publish = () => store.update({ focusedBuilding: focused, playerNation: "roman",
        buildings: ["0", "1"].map(id => ({ id, type: 29, completed: true,
          inventory: { boat: 2, horse: 1 }, storedHandcarts: 1,
          storage: { poolId: 0, available: { logs: 12, planks: 4 }, held: { logs: 2 }, incoming: {},
            stored: { logs: 14, planks: 4 }, capacity: 500 },
          storageCollect: { visible, available, wares: [...wares], unavailableWares,
            reason: available ? undefined : "Build a harbour on this island to collect wares" }
        })) });
      const noop = () => undefined;
      createBuildingDetailsMount(store, createExternalStore({ opened: 1, visible: true }), {
        onMinimap: noop, onRoadMode: noop, onRotate: noop, onSelectBuilding: noop, onSettings: noop,
        onStorageCollect: (uid: number, ware: string, enabled: boolean) => {
          calls.push({ uid, ware, enabled });
          const index = wares.indexOf(ware);
          if (enabled && index < 0) wares.push(ware);
          if (!enabled && index >= 0) wares.splice(index, 1);
          publish(); return true;
        }
      })(panel);
      (window as any).__collectReview = {
        state: () => ({ calls, wares }),
        show: () => { visible = true; publish(); },
        focus: () => { focused = "1"; publish(); },
        excludeStone: () => { unavailableWares = ["stone"]; publish(); },
        disable: () => { available = false; publish(); }
      };
      publish();
    }, locale);
    await page.locator('[data-ware="logs"]').waitFor();
    const action = page.locator('[data-storage-tool="collect"]');
    assert.equal(await action.count(), 0);
    await page.evaluate(() => (window as any).__collectReview.show());
    await action.waitFor(); assert.equal(await action.getAttribute("aria-pressed"), "false");
    const ware = (name: string) => page.locator(`[data-ware="${name}"]`);
    assert(await ware("logs").isDisabled());
    if (width === 390) await action.tap(); else { await action.focus(); await page.keyboard.press("Space"); }
    assert.equal(await action.getAttribute("aria-pressed"), "true");
    await ware("logs").click(); await ware("planks").click();
    assert.equal(await ware("logs").getAttribute("aria-pressed"), "true");
    assert.equal(await ware("planks").getAttribute("aria-pressed"), "true");
    await page.evaluate(() => (window as any).__collectReview.focus());
    await page.waitForFunction(() => document.querySelector('[data-building-inventory="1"]') !== null);
    assert.equal(await action.getAttribute("aria-pressed"), "false");
    assert.equal(await ware("logs").getAttribute("aria-pressed"), "true");
    await action.click(); await ware("logs").click();
    await page.evaluate(() => (window as any).__collectReview.excludeStone());
    assert(await ware("stone").isDisabled());
    const reason = await ware("stone").getAttribute("title");
    assert(reason?.includes(locale === "hu" ? "másik kikötő" : "another harbour"));
    assert(await ware("boat").isDisabled()); assert(await ware("horse").isDisabled());
    assert.equal(await page.locator('[data-storage-tool="receive"], [data-storage-tool="send"]').count(), 0);
    const state = await page.evaluate(() => (window as any).__collectReview.state());
    assert.deepEqual(state.wares, ["planks"]);
    assert.deepEqual(state.calls, [{ uid: 0, ware: "logs", enabled: true }, { uid: 0, ware: "planks", enabled: true },
      { uid: 1, ware: "logs", enabled: false }]);
    await action.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${width}-${locale}-active.png`) });
    await page.evaluate(() => (window as any).__collectReview.disable());
    assert(await action.isDisabled());
    const disabledTitle = await action.getAttribute("title");
    assert(disabledTitle?.includes(locale === "hu" ? "kikötőt" : "harbour"));
    assert.deepEqual(errors, []);
    reports.push({ width, locale, ...state, reason, disabledTitle, errors });
    await context.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ status: "PASS", reports,
    scope: "Actual mounted React controls and keyboard/touch with authored canonical snapshot callbacks; no physical voyage/domain eligibility proof or performance claim."
  }, null, 2));
} finally { await browser.close(); await server.close(); }
