import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { startEditorSession } from "./editor-native-session";

const s = await startEditorSession("minimal", "authored-model-diagnostic", false, 64, "editor.html");
try {
  const { page } = s;
  await page.evaluate(() => {
    const { renderer } = (window as any).__editorReview, original = renderer.render.bind(renderer);
    renderer.render = (frame: any) => {
      (window as any).__authoredDispatch = { buildings: frame.buildings?.length ?? 0,
        workers: frame.workers?.length ?? 0 };
      return original(frame);
    };
  });
  await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("adventure");
  await page.getByRole("tab", { name: "Units and camps", exact: true }).click();
  await page.getByRole("combobox", { name: "Enemy building", exact: true }).selectOption("bandit-catapult");
  await s.button("Place enemy building").click(); await s.click({ x: 32.5, z: 14.5 });
  await s.button("Place enemy group").click(); await s.click({ x: 35.5, z: 14.5 });
  await s.idle();
  const result = await page.evaluate(() => ({ scenario: (window as any).__editorReview.world.scenario,
    dispatch: (window as any).__authoredDispatch, markers: document.querySelectorAll(".map-editor__scenario-overlay img").length }));
  assert.equal(result.scenario.buildings.length, 1); assert.equal(result.scenario.units.length, 1);
  await page.screenshot({ path: resolve(s.output, "markers-visible.png") });
  await page.addStyleTag({ content: ".map-editor__scenario-overlay{display:none!important}" });
  await page.screenshot({ path: resolve(s.output, "markers-hidden-real-scene.png") });
  writeFileSync(resolve(s.output, "dispatch.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await s.close(); }
