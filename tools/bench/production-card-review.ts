import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

// Authored UI snapshots: checks native image loading/layout, not simulation throughput.
const output = resolve("../resources/production-card-review");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const width of [1200, 390]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/production-review.html", route => route.fulfill({
      contentType: "text/html", body: "<body></body>"
    }));
    await page.goto(`${url}production-review.html`);
    await page.evaluate(async theme => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css");
      await imp("/src/app/settlement-ui/index.ts");
      const { createBuildingDetailsMount } = await imp("/src/app/settlement-ui/building-details/mount.tsx");
      const { createSettlementUiStore } = await imp("/src/app/settlement-ui/ui-store.ts");
      const { createExternalStore } = await imp("/src/app/components/ui-store.ts");
      document.documentElement.style.cssText = "height:auto;overflow:auto";
      document.documentElement.dataset.hudTheme = theme;
      document.body.style.cssText = "background:#647954;margin:0;height:auto;overflow:auto";
      const root = document.createElement("div");
      root.className = "settlement-ui";
      root.style.cssText = "position:relative;display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px;padding:10px;pointer-events:auto";
      document.body.append(root);
      const examples = [
        { name: "Quarry", type: 19 }, { name: "Woodcutter", type: 17 },
        { name: "Forester", type: 20 }, { name: "Vineyard", type: 5 },
        { name: "Wheat farm", type: 37 }, { name: "Sawmill", type: 33 },
        { name: "Lookout", type: 14 }, { name: "Rice grower", type: 5, nation: "japanese" },
        { name: "Beekeeper", type: 5, nation: "viking" }, { name: "Fishery", type: 18 },
        { name: "Shipyard", type: 36 }, { name: "Metalworks", type: 25 }
      ];
      for (const example of examples) {
        const panel = document.createElement("section");
        panel.className = "settlement-ui__panel";
        panel.dataset.example = example.name;
        panel.style.cssText = "position:relative;inset:auto;width:330px;min-height:125px;padding:12px";
        root.append(panel);
        const store = createSettlementUiStore();
        const subject = { completed: true, id: "0", type: example.type, workshopUpgrade: { level: 1 } };
        store.update({ focusedBuilding: "0", playerNation: example.nation ?? "roman",
          buildings: [subject] });
        createBuildingDetailsMount(store, createExternalStore({ opened: 1, visible: true }), {
          onProductionMode: (_id: number, selectedOutput: string) => {
            store.update({ buildings: [{ ...subject, selectedOutput }] });
            return true;
          },
          onShipyardMode: (_id: number, shipyardMode: string) => {
            store.update({ buildings: [{ completed: true, id: "0", type: example.type, shipyardMode }] });
            return true;
          }
        })(panel);
      }
    }, theme);
    await page.locator("[data-production-resource]").first().waitFor();
    await page.locator('[data-example="Fishery"] img').first().waitFor();
    const images = await page.locator("img").evaluateAll(async elements => {
      const images = elements.filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map(image => image.decode()));
      return images.map(image => ({ source: image.getAttribute("src"), loaded: image.naturalWidth,
        width: image.getBoundingClientRect().width }));
    });
    assert(images.every(image => image.loaded > 0 && image.width > 0));
    assert.equal(await page.locator("[data-production-resource] b").count(), 0);
    assert.equal(await page.locator('[data-example="Sawmill"] [data-count="0"]').count(), 2);
    assert.equal(await page.locator('[data-example="Lookout"] .settlement-ui__ware-flow').count(), 0);
    const shipyard = page.locator('[data-example="Shipyard"]');
    const boat = shipyard.getByRole("button", { name: "Produce boats", exact: true });
    const ship = shipyard.getByRole("button", { name: "Produce ships", exact: true });
    await ship.click();
    assert.equal(await ship.getAttribute("aria-pressed"), "true");
    assert.equal(await boat.getAttribute("aria-pressed"), "false");
    const input = await shipyard.getByRole("group", { name: "Input wares", exact: true }).boundingBox();
    const choices = await shipyard.getByRole("group", { name: "Shipyard product", exact: true }).boundingBox();
    assert(input && choices && input.y < choices.y + choices.height && choices.y < input.y + input.height,
      "Shipyard inputs and output choices share a row");
    assert(Math.abs(input.width - choices.width) < 1, "Shipyard input/output bubbles have equal width");
    const sawmillGroups = await page.locator('[data-example="Sawmill"] .settlement-ui__ware-group')
      .evaluateAll(groups => groups.map(group => group.getBoundingClientRect().width));
    assert(Math.abs(sawmillGroups[0]! - sawmillGroups[1]!) < 1, "Sawmill input/output bubbles have equal width");
    const recipes = page.locator('[data-example="Sawmill"]').getByRole("radiogroup", { name: "Choose output" });
    await recipes.getByRole("radio").nth(1).check();
    assert.equal(await recipes.getByRole("radio").nth(1).isChecked(), true);
    const recipeSizes = await recipes.locator("img").evaluateAll(images =>
      images.map(image => image.getBoundingClientRect().width));
    const expectedIconSize = width <= 760 ? 44 : 48;
    assert(recipeSizes.every(size => Math.abs(size - expectedIconSize) < .01));
    const metalworks = page.locator('[data-example="Metalworks"]');
    const toolBoxes = await metalworks.locator(".settlement-ui__output-choice").evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().toJSON()));
    if (width > 760) {
      assert(toolBoxes.length >= 3);
      assert(toolBoxes.every(box => Math.abs(box.width - toolBoxes[0]!.width) < 1), "Equal tool-choice columns");
      assert(toolBoxes.slice(0, 3).every(box => Math.abs(box.y - toolBoxes[0]!.y) < 1), "Three tools per desktop row");
    }
    const random = metalworks.getByRole("radio").first();
    assert.equal(await random.isChecked(), true);
    assert(await random.locator("..").locator("img").count() > 1);
    await metalworks.getByRole("radio").nth(1).check();
    assert.equal(await random.isChecked(), false);
    const titleAlignment = await page.locator(".settlement-ui__ware-group-cells > [data-ware] > small")
      .evaluateAll(titles => titles.map(title => getComputedStyle(title).textAlign));
    assert(titleAlignment.every(alignment => alignment === "center"));
    assert.deepEqual(errors, []);
    await page.screenshot({ fullPage: true, path: resolve(output, `${width}-${theme}.png`) });
    await shipyard.screenshot({ path: resolve(output, `shipyard-${width}-${theme}.png`) });
    await page.locator('[data-example="Sawmill"]').screenshot({ path: resolve(output, `sawmill-${width}-${theme}.png`) });
    await metalworks.screenshot({ path: resolve(output, `metalworks-${width}-${theme}.png`) });
    reports.push({ width, theme, images, errors, recipeSizes, toolBoxes });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
