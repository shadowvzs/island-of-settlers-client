import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "verification-completion-2026-11-05", "mills", process.env.RUN ?? "native-a");
assert(!existsSync(resolve(output, "report.json")), "Use a new RUN to preserve evidence");
mkdirSync(output, { recursive: true });
const reports: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer();
const browser = await launchBrowser();
let status = "running", failure: string | undefined;
const save = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, failure, reports, errors,
  scope: "Actual whole mill model.update working animation, four rotor phases spanning a full turn; " +
    "close and gameplay views in both LODs. CPU triangle sweep covers every tier1–5 separately." }, null, 2));
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"])
    for (const nation of ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"]) {
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1&building=31`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      await page.evaluate(async () => {
        const p = (window as any).__buildingPreview;
        p.renderer.setAnimationLoop(null);
        await p.selectBuilding(31, 1);
        await ((window as any).__buildingResidentReady ?? Promise.resolve());
        p.model().root.rotation.y = 0;
        p.model().update(0, { construction: 1, door: 0, working: true });
        (window as any).__millReview = { time: 0, camera: p.camera.clone() };
      });
      const phases: number[] = [];
      for (let phase = 0; phase < 4; phase++) {
        const rotation = await page.evaluate(phase => {
          const p = (window as any).__buildingPreview, review = (window as any).__millReview;
          const target = phase * (Math.PI * 2 / 3) / 1.2;
          while (review.time < target) {
            review.time = Math.min(target, review.time + .05);
            p.model().update(review.time, { construction: 1, door: 0, working: true });
          }
          p.model().root.updateMatrixWorld(true);
          return p.model().root.getObjectByName("mechanism").rotation.z;
        }, phase);
        phases.push(rotation);
        for (const view of ["gameplay", "close"]) {
          await page.evaluate(view => {
            const p = (window as any).__buildingPreview, review = (window as any).__millReview;
            p.camera.copy(review.camera);
            if (view === "close") {
              p.camera.zoom *= 1.5;
              p.camera.updateProjectionMatrix();
            }
            p.renderer.render(p.scene, p.camera);
          }, view);
          await page.screenshot({ path: resolve(output, `${nation}-${quality}-${phase}-${view}.png`) });
        }
      }
      assert(phases[3]! - phases[0]! > Math.PI * 1.9, `${nation}/${quality}: actual renderer must turn through a full revolution`);
      reports.push({ nation, quality, phases }); save();
    }
  assert.deepEqual(errors, []);
  status = "passed"; save();
} catch (error) {
  status = "failed"; failure = String(error); save(); throw error;
} finally {
  await browser.close(); await server.close();
}
console.log(`Whole moving mills: ${reports.length} national/LOD cases, ${output}`);
