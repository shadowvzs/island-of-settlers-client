import assert from "node:assert/strict";

import { openDevelopmentAction } from "./development-ui-helpers";
import { exerciseEditorHarbour } from "./editor-harbour-acceptance";
import { startEditorSession } from "./editor-native-session";
import { exerciseEditorPatrolCombat, placeEditorGarrisonMatrix } from "./editor-scenario-military";
import { resumeSavedGame, saveFromMenu } from "./save-helpers";

/** Real authored controls and new Play; detached integration separately covers full type/rank combinations. */
for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
  const s = await startEditorSession(quality, "scenario"); const { button, page } = s;
  const tab = (name: string) => page.getByRole("tab", { name, exact: true }).click();
  try {
    const ROAD_ACTIONS = await page.evaluate(async () =>
      (await import(/* @vite-ignore */ String("/src/app/map-editor/scenario-road-editor.ts"))).ROAD_ACTIONS);
    await tab("Map, headquarters and scenario");
    await s.step("adventure-kind", async () => {
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("adventure");
    });
    const home = await page.evaluate(() => {
      const hq = (window as any).__settlement.simulation.headquarters;
      return { x: hq.x, z: hq.z };
    });
    await s.step("actual-headquarters", async () => { await button("Place HQ").click(); await s.click(home); });
    const landing = await page.evaluate(async () => {
      const { world } = (window as any).__editorReview;
      const { createScenarioInspectionContext } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-map-scenario.ts"));
      const { isNavigationClear } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-navigation.ts"));
      const context = createScenarioInspectionContext(world), hq = world.scenario.headquarters;
      for (let radius = 3; radius < 24; radius++)
        for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
          const point = { x: hq.x + dx + .5, z: hq.z + dz + .5 };
          if (isNavigationClear(context, point)) return point;
        }
      throw new Error("No legal landing point");
    });
    await s.step("landing", async () => { await button("Place landing").click(); await s.click(landing); });
    for (const weather of ["clear", "rain", "snow"]) await s.step(`defaults-${weather}`, async () => {
      await page.getByRole("spinbutton", { name: "Starting hour", exact: true }).fill("19.5");
      await page.getByRole("combobox", { name: "Starting weather", exact: true }).selectOption(weather);
      await button("Apply map time and weather").click();
    });
    for (const theme of ["tropical", "winter", "desert", "swamp", "forest"]) await s.step(`theme-${theme}`, async () => {
      await page.getByRole("combobox", { name: "Enemy theme", exact: true }).selectOption(theme);
    });
    const road = await page.evaluate(async () => {
      const { world } = (window as any).__editorReview;
      const { createScenarioInspectionContext } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-map-scenario.ts"));
      const { createScenarioRoadNetwork } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/scenario-road-placement.ts"));
      const hq = world.scenario.headquarters;
      for (let dz = -15; dz <= 15; dz += 2) for (let dx = -15; dx <= 15; dx += 2) {
        const start = { x: hq.x + dx + .5, z: hq.z + dz + .5 }, end = { x: start.x + 4, z: start.z };
        const roads = createScenarioRoadNetwork(createScenarioInspectionContext(world));
        if (roads.addRoad(start, end)) return { start, end };
      }
      throw new Error("No legal natural authored road route");
    });
    for (const action of ROAD_ACTIONS.slice(0, 6)) await s.step(`road-${action.replaceAll(" ", "-")}`, async () => {
      await page.getByRole("combobox", { name: "Infrastructure action", exact: true }).selectOption(action);
      await button("Draw selected infrastructure").click(); await s.click(road.start); await s.click(road.end);
      assert.match(await page.locator(".map-editor__status").innerText(), /Initial road graph updated/);
    });
    const harbour = await page.evaluate(async () => {
      const { world } = (window as any).__editorReview;
      const { createScenarioInspectionContext } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-map-scenario.ts"));
      const { shoreCells } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-debug-harbour.ts"));
      const { makeBuilding, placementReason } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-placement.ts"));
      const context = createScenarioInspectionContext(world), home = context.buildings[0];
      let count = 0;
      for (const point of shoreCells(context, home)) {
        if (++count > 512) break;
        for (let rotation = 0; rotation < 4; rotation++) {
          const draft = makeBuilding(context, 39, point.x, point.z, rotation);
          if (!placementReason(context, draft)) return { x: draft.x, z: draft.z, rotation, checks: count };
        }
      }
      return null;
    });
    if (harbour) await s.step("real-harbour-ocean-turning-reservation", async () => {
      await page.getByRole("combobox", { name: "Infrastructure action", exact: true }).selectOption("Reserve harbour");
      await page.getByRole("spinbutton", { name: "Harbour rotation", exact: true }).fill(String(harbour.rotation));
      await button("Draw selected infrastructure").click(); await s.click(harbour);
      assert.match(await page.locator(".map-editor__status").innerText(), /real shore, ocean and ship turning/);
    });
    else s.rows.push({ name: "harbour-reservation", outcome: "unknown", detail: "No legal owned shore plot in512checks" });
    await tab("Units and camps");
    const unit = await page.evaluate(async () => {
      const { world } = (window as any).__editorReview;
      const { validateMapScenario } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-map-scenario.ts"));
      const scenario = structuredClone(world.scenario);
      for (let z = 24; z < world.cellsZ - 24; z += 4) for (let x = 24; x < world.cellsX - 24; x += 4) {
          const candidate = { ...world, scenario: { ...scenario, units: [{ id: 1, x, z, type: "shield",
            rank: 1, faction: 2, group: 0, heading: 0 }] } };
          if (!validateMapScenario(candidate).length) return { x, z };
        }
        throw new Error("No legal natural authored unit point");
    });
    await s.step("ranked-field-unit", async () => {
      await page.getByRole("combobox", { name: "Troop", exact: true }).selectOption("shield");
      await page.getByRole("spinbutton", { name: "Enemy faction", exact: true }).fill("2");
      await page.getByRole("spinbutton", { name: "Unit rank", exact: true }).fill("2");
      await button("Place enemy group").click(); await s.click(unit);
    });
    for (const [dx, dz] of [[2, 0], [2, 2]]) await s.step(`patrol-${dx}-${dz}`, async () => {
      await page.getByRole("spinbutton", { name: "Patrol waypoint X", exact: true }).fill(String(unit.x + dx!));
      await page.getByRole("spinbutton", { name: "Patrol waypoint Z", exact: true }).fill(String(unit.z + dz!));
      await button("Add patrol waypoint").click();
    });
    const expectedGarrisons = await placeEditorGarrisonMatrix(s);
    await button("Validate patrol links").click();
    await tab("Map, headquarters and scenario");
    const authored = await page.evaluate(() => structuredClone((window as any).__editorReview.world.scenario));
    const previous = await s.runtimeToken();
    await button("Play authored map").click();
    await page.waitForURL(/map=/, { timeout: 60000 });
    await s.waitForRuntime(previous);
    const actual = await page.evaluate(() => {
      const { environment, world } = (window as any).__editorReview;
      const simulation = (window as any).__settlement.simulation;
      return { scenario: world.scenario, environment: environment.getControls(), save: simulation.saveState(),
        soldiers: simulation.militarySoldiers() };
    });
    assert.deepEqual(actual.scenario, authored);
    assert.equal(actual.environment.snowing, true);
    assert.equal(actual.environment.raining, false);
    assert(actual.save.authoredScenario?.patrols?.length > 0);
    for (const group of expectedGarrisons)
      assert(actual.soldiers.some((soldier: any) => soldier.rank === group.rank &&
        soldier.combat?.type === group.type && soldier.stationed),
      `The actual game must restore ${group.type} rank ${group.rank} in its authored garrison`);
    s.rows.push({ name: "new-play-authoritative-definition-weather-and-patrol", environment: actual.environment,
      patrols: actual.save.authoredScenario.patrols, scenario: actual.scenario });
    await exerciseEditorPatrolCombat(s);
    await page.evaluate(() => (window as any).__editorReview.environment.toggleRain());
    await saveFromMenu(page);
    await resumeSavedGame(page);
    const restoredWeather = await page.evaluate(() => {
      const { environment, world } = (window as any).__editorReview;
      return { defaults: world.environmentDefaults, runtime: environment.getControls() };
    });
    assert.equal(restoredWeather.defaults.snow, true);
    assert.equal(restoredWeather.runtime.raining, true);
    assert.equal(restoredWeather.runtime.snowing, false);
    s.rows.push({ name: "actual-game-reload-runtime-weather-overrides-map-defaults", ...restoredWeather });
    // Adventure authoring deliberately forbids player construction. Retain the exact
    // reserved coast, remove hostile authored objects through their own controls,
    // and independently Play a peaceful home before testing real harbour navigation.
    await (await openDevelopmentAction(page, "Map editor")).click();
    await page.getByRole("tab", { name: "Units and camps", exact: true }).waitFor({ state: "visible" });
    await tab("Units and camps");
    const objects = page.getByRole("combobox", { name: "Authored object", exact: true });
    while (await objects.isVisible()) {
      const first = await objects.locator("option").evaluateAll(options =>
        options.map(option => (option as HTMLOptionElement).value).find(Boolean));
      if (!first) break;
      await objects.selectOption(first);
      await button("Remove selected").click();
    }
    await tab("Map, headquarters and scenario");
    await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("home");
    const homeToken = await s.runtimeToken();
    await button("Play authored map").click();
    await s.waitForRuntime(homeToken);
    assert.equal(await page.evaluate(() => (window as any).__editorReview.world.scenario.kind), "home");
    s.rows.push({ name: "independent-ui-authored-peaceful-home-for-reserved-harbour" });
    await exerciseEditorHarbour(s);
    assert.deepEqual(s.errors, []);
  } catch (error) { s.rows.push({ name: "failure", error: error instanceof Error ? error.stack : String(error) }); throw error; }
  finally { await s.close(); }
}
