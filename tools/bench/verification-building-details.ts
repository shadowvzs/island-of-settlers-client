import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv[2] ?? "art-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05", run);
assert(!existsSync(output), "Preserve previous capture attempts; select a new run ID");
mkdirSync(output, { recursive: true });
const cases = [
  { id: 8, nation: "roman", target: "vat" },
  { id: 5, nation: "maya", target: "nursery" },
  { id: 5, nation: "maya", target: "basket" },
  ...[17, 3, 5].flatMap(id => [1, 3, 5].map(level => ({ id, level, nation: "maya", target: "roof" }))),
  { id: 0, nation: "maya", target: "relief" },
  { id: 0, nation: "persian", target: "entrance" },
  ...[6, 29, 58, 61].map(id => ({ id, nation: "persian", target: "awning" })),
  ...[1, 3, 5].map(level => ({ id: 36, level, nation: "indigenous", target: "entrance" }))
];
const filteredCases = process.env.TARGETS
  ? cases.filter(entry => process.env.TARGETS!.split(",").includes(entry.target)) : cases;
const reports: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    let selectedNation = "";
    for (const entry of filteredCases) {
      if (selectedNation !== entry.nation) {
        await page.goto(`${url}building-showcase.html?nation=${entry.nation}&quality=${quality}&sample=1&building=${entry.id}`);
        await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
        selectedNation = entry.nation;
      }
      const level = "level" in entry ? entry.level : 1;
      const result = await page.evaluate(async ({ id, level, target }) => {
        const p = (window as any).__buildingPreview;
        p.renderer.setAnimationLoop(null);
        await p.selectBuilding(id, level);
        await ((window as any).__buildingResidentReady ?? Promise.resolve());
        const model = p.model();
        model.root.rotation.y = 0;
        model.update(0, { construction: 1, door: 0, working: true });
        model.root.updateMatrixWorld(true);
        const parts = model.recipe.parts;
        const selected = parts.filter((part: any) => {
          if (target === "vat") return part.shape === "vat-liquid";
          if (target === "nursery") return part.shape.startsWith("cacao-");
          if (target === "basket") return Math.abs(part.position[0] - 1.12) < .001 &&
            Math.abs(part.position[2] - .61) < .001 && ["ring", "cylinder"].includes(part.shape);
          if (target === "roof") return Boolean(part.plantRoofStyle);
          if (target === "relief") return part.shape === "maya-civic-mask";
          if (target === "awning") return part.shape === "persian-striped-awning";
          return false;
        });
        return { selected, triangles: model.triangles(false), partCount: parts.length };
      }, { ...entry, level });
      if (entry.target === "vat") assert.equal(result.selected.length, 2, "Actual exposed tanning vats");
      if (entry.target === "nursery") assert.equal(result.selected.length, 6, "Both complete cacao trees");
      if (entry.target === "basket") assert.equal(result.selected.length, 3, "Basket body, rim and interior survive fitting");
      if (entry.target === "roof" || entry.target === "relief") assert(result.selected.length > 0);
      for (const view of ["gameplay", "detail", "reverse"]) {
        const projection = await page.evaluate(async ({ selected, target, view }) => {
          const p = (window as any).__buildingPreview;
          const t = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
          const model = p.model(), box = new t.Box3().setFromObject(model.root);
          const size = box.getSize(new t.Vector3()), centre = box.getCenter(new t.Vector3());
          const reach = Math.max(size.x, size.y, size.z);
          let focus = centre.clone(), span = reach;
          if (view !== "gameplay" && selected.length) {
            const part = selected[0];
            focus = model.root.localToWorld(new t.Vector3(...part.position));
            span = Math.max(...part.size) * model.root.scale.x * 1.8;
            if (target === "vat") span = 1.6 * model.root.scale.x;
            if (target === "roof") {
              focus.y -= part.size[1] * model.root.scale.y * .1;
              focus.z += part.size[2] * model.root.scale.z * .35;
              span *= .42;
            }
            if (target === "awning") span = Math.max(.75, span * .65);
          }
          if (view === "gameplay") p.camera.position.copy(centre).add(new t.Vector3(reach, reach * .8, reach * 1.2));
          else {
            const side = view === "reverse" ? -1 : 1;
            const height = target === "vat" ? span * 1.1 : span * .45;
            p.camera.position.copy(focus).add(new t.Vector3(side * span * .8, height, side * span));
            if (target === "awning" && selected.length) {
              const outward = Math.sign(selected[0].position[0]);
              p.camera.position.copy(focus).add(new t.Vector3(outward * span, span * .42,
                side * span * .65));
            }
          }
          p.camera.lookAt(focus);
          if (p.camera.isOrthographicCamera) {
            p.camera.zoom = Math.min((p.camera.right - p.camera.left) / (span * 1.35),
              (p.camera.top - p.camera.bottom) / (span * 1.15));
            p.camera.updateProjectionMatrix();
          }
          p.camera.updateMatrixWorld(true);
          p.renderer.render(p.scene, p.camera);
          const visible = focus.clone().project(p.camera);
          return { focus: focus.toArray(), span, visible: visible.toArray() };
        }, { selected: result.selected, target: entry.target, view });
        const name = `${entry.nation}-${entry.id}-l${level}-${quality}-${entry.target}-${view}`;
        await page.screenshot({ path: resolve(output, `${name}.png`) });
        reports.push({ ...entry, level, name, projection, quality, result });
      }
      writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports, status: "capturing" }, null, 2));
      console.log(`${entry.nation}/${entry.id}/L${level}/${quality}`);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports,
    status: "Captured actual building models; visual inspection and live-worker proof tracked separately" }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
