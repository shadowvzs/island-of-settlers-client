import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { startEditorSession } from "./editor-native-session";

for (const quality of ["minimal", "high"]) {
  const s = await startEditorSession(quality, "authored-model-visible", false, 64, "editor.html");
  const { page } = s;
  let phase = "actual-ui";
  const observe = () => page.evaluate(() => {
    const { renderer } = (window as any).__editorReview, original = renderer.render.bind(renderer);
    renderer.render = (frame: any) => { (window as any).__authoredFrame = frame; return original(frame); };
  });
  const meshHit = (frame: any) => page.evaluate(frame => {
    const { renderer } = (window as any).__editorReview;
    for (const height of [.3, 1, 2, 3, 4, 6, 8]) for (const dx of [0, -.5, .5, -1, 1]) {
      const point = renderer.projectToViewport(frame.x + dx, frame.y + height, frame.z);
      if (renderer.pickBuilding(point.x, point.y) === frame.id) return { point, height, dx };
    }
    return null;
  }, frame);
  try {
    await observe();
    await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
    await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("adventure");
    await page.getByRole("tab", { name: "Units and camps", exact: true }).click();
    await page.getByRole("combobox", { name: "Enemy building", exact: true }).selectOption("bandit-catapult");
    await s.step("actual-ui-building-placement", async () => {
      await s.button("Place enemy building").click(); await s.click({ x: 32.5, z: 14.5 });
    });
    await s.button("Place enemy group").click(); await s.click({ x: 35.5, z: 14.5 });
    await page.addStyleTag({ content: ".map-editor__scenario-overlay{display:none!important}" });
    const ui = await page.evaluate(() => ({ buildings: (window as any).__authoredFrame.buildings.length,
      workers: (window as any).__authoredFrame.workers.length }));
    assert.deepEqual(ui, { buildings: 1, workers: 1 });
    phase = "separate-source-fixtures-real-building-meshes";
    // Separate format-valid fixtures at a known anchor avoid pretending seven camps fit one plot.
    const choices = [{ type: 0, x: 29, z: 38, rotation: 0 }, { type: 1, x: 29, z: 14, rotation: 0 },
      { type: 2, bandit: { code: 0, layout: 0 }, x: 17, z: 11, rotation: 1 },
      { type: 4, bandit: { code: 1, layout: 1 }, enclosure: "building", x: 38, z: 14.5, rotation: 2 },
      { type: 9, bandit: { code: 2, layout: 2 }, x: 32, z: 23, rotation: 3 },
      { type: 16, catapult: { variant: "bandit", stones: 6 }, x: 47.5, z: 26.5, rotation: 0 },
      { type: 16, catapult: { variant: "pirate", stones: 6 }, x: 11.5, z: 29.5, rotation: 1 }];
    for (const [index, choice] of choices.entries()) {
      await page.evaluate(async choice => {
        const { world } = (window as any).__editorReview;
        const { createMapScenario } = await import(/* @vite-ignore */ String("/src/shared/world/map-scenario.ts"));
        const point = { x: choice.x, z: choice.z, rotation: choice.rotation };
        world.scenario = { ...createMapScenario(), kind: "adventure", nation: "japanese", theme: "forest",
          ...(choice.type === 0 ? { headquarters: point } : { buildings: [{ ...choice, ...point, id: 1, faction: 2, defenders: 0 }] }) };
        world.buildRevision = (world.buildRevision ?? 0) + 1;
      }, choice);
      await s.idle();
      const frame = await page.evaluate(() => (window as any).__authoredFrame.buildings[0]);
      await s.focus(frame);
      const proof = await meshHit(frame);
      assert(proof, `Actual 3D mesh must be pickable for ${JSON.stringify(choice)}`);
      s.rows.push({ name: "real-building-mesh-raycast", choice, frame, proof });
      await page.screenshot({ path: resolve(s.output, `building-${index}-${choice.type}.png`) });
    }
    phase = "loose-unit-rigs-roads-deposits-harbour";
    await page.evaluate(() => {
      const { world } = (window as any).__editorReview;
      world.scenario.buildings = [{ id: 1, type: 4, bandit: { code: 1, layout: 1 }, enclosure: "building", faction: 2,
        defenders: 0, rotation: 0, x: 32, z: 14 }];
      world.scenario.units = ["shield", "heavy", "archer"].map((type, index) => ({ id: 20 + index,
        type, rank: index, faction: 2, group: 0, x: 32.5 + index, z: 20.5, heading: .4 }));
      world.scenario.roads = Array.from({ length: 12 }, (_, index) => ({
        start: { x: 30 + index * .5, z: 22 }, end: { x: 30 + (index + 1) * .5, z: 22 }, tier: "stone" }));
      world.scenario.marbleDeposits = [{ id: 0, x: 32, z: 24, remaining: 10, material: "granite" }];
      world.scenario.harbourPlot = { x: 37, z: 10, rotation: 0 };
      world.buildRevision = (world.buildRevision ?? 0) + 1;
    });
    await s.idle();
    const units = await page.evaluate(() => structuredClone((window as any).__editorReview.world.scenario.units));
    for (const unit of units) {
      await s.focus(unit, 2);
      await page.waitForFunction(id => Boolean((window as any).__editorReview.renderer.militaryEyeOffset(id, false)),
        unit.id, { timeout: 60000 });
      const eye = await page.evaluate(id => (window as any).__editorReview.renderer.militaryEyeOffset(id, false), unit.id);
      s.rows.push({ name: "real-loaded-worker-rig", unit, eye });
      await page.screenshot({ path: resolve(s.output, `unit-${unit.type}.png`) });
    }
    await s.focus({ x: 32, z: 23 });
    await page.screenshot({ path: resolve(s.output, "road-and-deposit.png") });
    await s.focus({ x: 37, z: 10 });
    await page.screenshot({ path: resolve(s.output, "harbour-reservation.png") });
    phase = "live-theme-and-nation";
    await page.evaluate(() => {
      const { world } = (window as any).__editorReview;
      world.scenario.theme = "winter"; world.scenario.nation = "persian";
      world.buildRevision = (world.buildRevision ?? 0) + 1;
    });
    await s.idle();
    const changed = await page.evaluate(() => ({ frame: (window as any).__authoredFrame.buildings[0],
      roads: (window as any).__authoredFrame.roads.length, deposits: (window as any).__authoredFrame.marbleDeposits.length,
      harbour: (window as any).__authoredFrame.placementGhost }));
    assert.equal(changed.frame.nation, "persian"); assert.equal(changed.frame.enemyStyle.theme, "winter");
    assert.equal(changed.roads, 12); assert.equal(changed.deposits, 1); assert.equal(changed.harbour.type, 39);
    await s.focus(changed.frame); assert(await meshHit(changed.frame));
    await page.screenshot({ path: resolve(s.output, "live-winter-persian.png") });
    phase = "native-map-save-reload";
    assert(await page.evaluate(async () => {
      const { isMapScenario } = await import(/* @vite-ignore */ String("/src/shared/world/map-scenario.ts"));
      const { world } = (window as any).__editorReview;
      return isMapScenario(world.scenario, world.cellsX, world.cellsZ);
    }), "Seeded native fixture must pass the actual scenario schema before save");
    await s.save(); await observe(); await s.focus(changed.frame);
    assert(await meshHit(changed.frame));
    phase = "ordinary-home-deposits-and-exit-clear";
    await page.evaluate(() => {
      const { world } = (window as any).__editorReview;
      world.scenario = undefined; world.colonyStoneDeposits = [{ id: 1, x: 32, z: 24, remaining: 12, material: "granite" }];
      world.buildRevision = (world.buildRevision ?? 0) + 1;
    });
    await s.idle(); await s.focus({ x: 32, z: 24 });
    const ordinary = await page.evaluate(() => ({ buildings: (window as any).__authoredFrame.buildings.length,
      workers: (window as any).__authoredFrame.workers.length, deposits: (window as any).__authoredFrame.marbleDeposits.length }));
    assert.deepEqual(ordinary, { buildings: 0, workers: 0, deposits: 1 });
    await page.screenshot({ path: resolve(s.output, "ordinary-home-deposit.png") });
    await page.evaluate(() => (window as any).__editorReview.mapEditor.setEnabled(false)); await s.idle();
    assert.equal(await page.evaluate(() => (window as any).__authoredFrame.marbleDeposits.length), 0);
    assert.deepEqual(s.errors, []);
    s.rows.push({ name: "matrix-complete", ui, changed, ordinary,
      scope: "Real UI placement/history; separate declared source fixtures; real mesh raycasts/loaded rigs, no simulation" });
  } catch (error) {
    s.rows.push({ name: "failed", phase, error: error instanceof Error ? error.stack : String(error) });
    writeFileSync(resolve(s.output, "failure-body.txt"), await page.locator("body").innerText().catch(() => "unavailable"));
    await page.screenshot({ path: resolve(s.output, "failure.png"), timeout: 10000 }).catch(() => {});
    throw error;
  } finally { await s.close(); }
}
