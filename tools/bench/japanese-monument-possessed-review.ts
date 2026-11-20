import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { nativeDryFixture } from "./native-dry-fixture";

const nation = process.env.MONUMENT_REVIEW_NATION ?? "japanese";
const output = resolve(process.env.MONUMENT_POSSESSED_OUT ??
  "../resources/project-reviews/japanese-monument-continuity/possessed");
mkdirSync(output, { recursive: true });
const save = await nativeDryFixture(JSON.parse(readFileSync(resolve(
  "../resources/project-reviews/nation-expansion-current/monument-fixtures/continuous-completed.json"), "utf8")));
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/pagoda-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__pagodaReview={world,camera,renderer};window.__islandReady = true") });
    });
    await page.goto(`${url}pagoda-fixture.html`);
    await page.evaluate(async saved => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
      const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
      settingsStorage.writeFog(false); saved.savedAt = Date.now();
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
    }, save);
    await page.goto(`${url}?quality=${quality}&cache=0&reveal=1&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__exploration), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180000 });
    const site = await page.evaluate(async nation => {
      const sim = (window as any).__settlement.simulation, review = (window as any).__pagodaReview;
      sim.setPlayerNation(nation);
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const { randomWorkerAppearances } = await imp("/src/render-common/workers/worker-appearance.ts");
      const appearances = randomWorkerAppearances(12, nation, () => .37);
      await review.renderer.setWorkerAppearances(appearances);
      (window as any).__settlement.setPlayerAppearances(appearances);
      const building = sim.buildings().find((value: any) => value.typeId === 7);
      Object.assign(review.camera, { centerX: building.x, centerZ: building.z + 9, yaw: Math.PI, tilt: 0, zoom: 2 });
      return { x: building.x, y: building.y, z: building.z };
    }, nation);
    await page.waitForTimeout(400);
    await page.evaluate(() => (window as any).__exploration.controller.enter());
    await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null, { timeout: 60000 });
    const views = [];
    const targetsByNation: Record<string, number[]> = { chinese: [2.4, 3.2, 4.1], indigenous: [1.2, 3.7, 5.8] };
    const targets = targetsByNation[nation] ?? [5, 5.3, 9];
    for (const [name, targetY, spyglass] of [["whole", targets[0]!, false],
      ["middle", targets[1]!, true], ["upper", targets[2]!, true]] as const) {
      const pose = await page.evaluate(({ site, spyglass, targetY }) => {
        const controller = (window as any).__exploration.controller;
        const initial = controller.frame().camera.pose;
        const yaw = Math.atan2(site.x - initial.x, site.z - initial.z);
        const pitch = Math.atan2(site.y + targetY - initial.y, Math.hypot(site.x - initial.x, site.z - initial.z));
        for (let step = 0; step < 240; step++) {
          const current = controller.frame().camera.pose;
          const delta = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
          controller.setLook(delta * 12, (pitch - current.pitch) * 12); controller.update(.025);
        }
        controller.clearInputs();
        if (controller.snapshot().spyglass !== spyglass) controller.toggleSpyglass();
        return { phase: controller.phase(), pose: controller.frame().camera.pose };
      }, { site, targetY, spyglass });
      assert.equal(pose.phase, "possessed"); assert.equal(pose.pose.mode, "eye");
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(output, `${quality}-${name}.png`) }); views.push({ name, ...pose });
    }
    assert.deepEqual(errors, []); reports.push({ quality, site, errors, views }); await page.close();
  }
} finally { await browser.close(); await server.close(); }
writeFileSync(resolve(output, "review.json"), JSON.stringify({ provenance: "Current paid-construction save; real exploration enter and look controls; no camera pose injection", reports }, null, 2));
console.log(JSON.stringify(reports));
