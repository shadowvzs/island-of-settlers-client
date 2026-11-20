import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { startEditorSession } from "./editor-native-session";

/** Production Map editor, actual marker clicks and panel controls; no runtime combat or art acceptance claim. */
const s = await startEditorSession(process.argv[2] ?? "minimal", "hostile-context", false, 64, "editor.html");
let phase = "initial-map-tab";
const { button, page } = s;
try {
  await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("adventure");
  phase = "place-headquarters";
  const home = await page.evaluate(() => {
    const site = (window as any).__editorReview.world.start;
    return { x: site.x, z: site.z };
  });
  await button("Place HQ").click(); await s.click(home);
  const landing = await page.evaluate(async () => {
    const { createScenarioInspectionContext } = await import(/* @vite-ignore */ String(
      "/src/shared/settlement/settlement-map-scenario.ts"));
    const point = createScenarioInspectionContext((window as any).__editorReview.world).buildings[0].access;
    return { x: point.x, z: point.z };
  });
  phase = "find-legal-plots";
  const points = await page.evaluate(async landing => {
    const { world } = (window as any).__editorReview;
    const { validateMapScenario } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-map-scenario.ts"));
    const base = structuredClone(world.scenario), result: { x: number; z: number }[] = [];
    // This finds positions only. Authored objects below are created by visible UI and canvas events.
    for (let z = 8.5; z < world.cellsZ - 8; z += 3) for (let x = 8.5; x < world.cellsX - 8; x += 3) {
      if (result.some(point => Math.hypot(point.x - x, point.z - z) < 24)) continue;
      const buildings = [...result, { x, z }].map((point, index) => ({ ...point, id: index + 1,
        type: 16, rotation: 0, faction: index + 2, defenders: 2,
        catapult: { variant: index === 0 ? "bandit" : "pirate", stones: 6 } }));
      const candidate = { ...world, scenario: { ...base, landing, buildings } };
      if (validateMapScenario(candidate).length === 0) result.push({ x, z });
      if (result.length === 2) return result;
    }
    throw new Error("No two legal actual-world Catapult plots");
  }, landing);
  phase = "place-landing";
  await button("Place landing").click(); await s.click(landing);
  await page.getByRole("tab", { name: "Units and camps", exact: true }).click();
  phase = "place-hostile-towers";
  for (const [index, variant] of ["bandit", "pirate"].entries()) {
    await page.getByRole("combobox", { name: "Enemy building", exact: true }).selectOption(`${variant}-catapult`);
    await page.getByRole("spinbutton", { name: "Enemy faction", exact: true }).fill(String(index + 2));
    await s.step(`${variant}-place`, async () => {
      await button("Place enemy building").click(); await s.click(points[index]!);
    });
  }
  const authored = await page.evaluate(() => structuredClone((window as any).__editorReview.world.scenario.buildings));
  phase = "click-marker-and-edit-inspector";
  for (const [index, entry] of authored.entries()) {
    await s.focus(points[index]!);
    const marker = page.locator(`[data-catapult-id="${entry.id}"]`);
    await marker.click();
    await page.getByRole("spinbutton", { name: "Stones on roof", exact: true }).waitFor();
    assert.equal(await page.getByRole("spinbutton", { name: "Stones below", exact: true }).inputValue(), "4");
    await page.getByRole("spinbutton", { name: "Stones below", exact: true }).fill("1");
    await button("Cancel Catapult changes").click();
    assert.equal(await page.getByRole("spinbutton", { name: "Stones below", exact: true }).inputValue(), "4");
    const inspector = page.getByRole("heading", { name: "Selected Catapult", exact: true }).locator("..");
    await s.step(`${entry.catapult.variant}-inspector-apply`, async () => {
      await inspector.getByRole("spinbutton", { name: "Heavy infantry rank 1 count", exact: true }).fill("0");
      await inspector.getByRole("spinbutton", { name: "Heavy infantry rank 3 count", exact: true }).fill("1");
      await inspector.getByRole("spinbutton", { name: "Shield rank 1 count", exact: true }).fill("0");
      await inspector.getByRole("spinbutton", { name: "Shield rank 2 count", exact: true }).fill("2");
      await page.getByRole("spinbutton", { name: "Stones on roof", exact: true }).fill("1");
      await page.getByRole("spinbutton", { name: "Stones below", exact: true }).fill("3");
      await button("Apply Catapult changes").click();
    });
  }
  const result = await page.evaluate(() => structuredClone((window as any).__editorReview.world.scenario.buildings));
  assert(result.every((entry: any) => entry.catapult.stones === 4 && entry.catapult.roofStones === 1));
  const identity = (entry: any) => ({ id: entry.id, faction: entry.faction, x: entry.x, z: entry.z,
    rotation: entry.rotation, type: entry.type, variant: entry.catapult.variant });
  assert.deepEqual(result.map(identity), authored.map(identity));
  assert(result.every((entry: any) => entry.defenders === 3 && entry.garrison.some((group: any) =>
    group.type === "heavy" && group.rank === 2 && group.count === 1)));
  phase = "remove-selected-and-restore-history";
  const beforeDelete = await s.digest();
  await button("Remove selected").click(); await s.idle();
  assert.equal(await page.evaluate(() => (window as any).__editorReview.world.scenario.buildings.length), 1);
  await button("Undo (Ctrl+Z)").click(); await s.idle(); assert.deepEqual(await s.digest(), beforeDelete);
  await button("Redo (Ctrl+Y / Ctrl+Shift+Z)").click(); await s.idle();
  assert.equal(await page.evaluate(() => (window as any).__editorReview.world.scenario.buildings.length), 1);
  await button("Undo (Ctrl+Z)").click(); await s.idle(); assert.deepEqual(await s.digest(), beforeDelete);
  s.rows.push({ name: "actual-selected-tower-delete-undo-redo-undo", exactHistory: true });
  phase = "browser-map-save-reload";
  await s.save();
  // Standalone authoring deliberately has no live settlement: this is a declared detached engine probe.
  phase = "detached-postload-engine-probe";
  const runtime = await page.evaluate(async () => {
    const { createSettlementSimulation } = await import(/* @vite-ignore */ String(
      "/src/shared/settlement/settlement-simulation.ts"));
    const { createRoadNetwork } = await import(/* @vite-ignore */ String(
      "/src/shared/settlement/road-network.ts"));
    const { world } = (window as any).__editorReview;
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
    const saved = simulation.saveState();
    return saved.buildings.filter((site: any) => site.typeId === 16).map((site: any) => ({
      variant: site.enemyCatapultVariant, faction: site.militaryFaction, roof: site.input.stone,
      ground: site.catapultSupply?.ground, porter: saved.actors.find((actor: any) => actor.uid === site.worker),
      crew: saved.military.soldiers.filter((soldier: any) => soldier.building === site.uid)
    }));
  });
  assert.equal(runtime.length, 2);
  for (const tower of runtime) {
    // The real service may already have moved a stone upstairs; conservation includes hand cargo.
    assert(tower.roof >= 0 && tower.roof <= 2);
    assert.equal(tower.roof + tower.ground + Number(tower.porter.ware === "stone"), 4);
    assert.equal(tower.porter.job, "Carrier");
    assert.equal(tower.porter.hostileCivilianFaction, tower.faction);
    assert.equal(tower.crew.length, 3);
    assert(tower.crew.every((soldier: any) => soldier.actor !== tower.porter.uid));
    assert(tower.crew.some((soldier: any) => soldier.rank === 2 && soldier.combat.type === "heavy"));
  }
  s.rows.push({ name: "detached-engine-after-actual-editor-map-reload", runtime });
  assert.deepEqual(s.errors, []);
  s.rows.push({ name: "actual-placed-marker-inspector-save-reload", authored, result });
} catch (error) {
  s.rows.push({ name: "failed", phase, error: error instanceof Error ? error.stack : String(error) });
  writeFileSync(resolve(s.output, "failure-body.txt"), await page.locator("body").innerText().catch(() => "unavailable"));
  await page.screenshot({ path: resolve(s.output, "failure.png"), timeout: 10000 }).catch(() => {});
  throw error;
} finally { await s.close(); }
