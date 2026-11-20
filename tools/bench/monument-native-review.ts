import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { MONUMENT_ASSETS } from "../../src/render-common/buildings/monument-definition";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { launchBrowser, startDevServer } from "./browser";
import { nativeDryFixture } from "./native-dry-fixture";
import { resourcesPath } from "./resources-path";

const base = process.env.FIXTURE_DIR ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "monument-construction");
const saves = Object.fromEntries(await Promise.all(["initial", "partial", "continuous-completed", "stocked-authored-foundation"].map(async stage =>
  [stage, await nativeDryFixture(JSON.parse(readFileSync(resolve(base, `${stage}.json`), "utf8")))])));
const output = process.env.OUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "monument-native");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
let activePage: Awaited<ReturnType<typeof browser.newPage>> | undefined, phase = "boot";
let failureErrors: string[] = [];
try {
  for (const quality of process.env.QUALITIES?.split(",") ?? ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1600 } }), errors: string[] = [];
    activePage = page; failureErrors = errors; phase = `${quality}/boot`;
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/monument-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__monumentReview={world,camera,renderer};window.__islandReady = true") });
    });
    await page.goto(`${url}monument-fixture.html`);
    await page.evaluate(async save => {
      const [{ openLocalSaveStore }, { settingsStorage }] = await Promise.all([
        import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts")),
        import(/* @vite-ignore */ String("/src/app/settings/graphics-settings.ts"))]);
      save.savedAt = Date.now(); settingsStorage.writeFog(false);
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(save));
    }, saves["continuous-completed"]);
    await page.goto(`${url}?quality=${quality}&cache=0&reveal=1&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement), null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
    await page.evaluate(async () => {
      const sim = (window as any).__settlement.simulation;
      (window as any).__monumentAdvance = sim.update.bind(sim); sim.update = () => {};
      const { renderer, world } = (window as any).__monumentReview, original = renderer.render;
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      (window as any).__monumentHour = 12;
      renderer.render = (frame: any) => original({ ...frame,
        environment: computeEnvironment(world.sun, (window as any).__monumentHour, 0, 0, 0) });
    });
    for (const nation of (process.env.NATIONS?.split(",") ?? Object.keys(MONUMENT_ASSETS)) as WorkerNation[]) {
      phase = `${quality}/${nation}`;
      const state = await page.evaluate(async ({ height, nation, save }) => {
        const sim = (window as any).__settlement.simulation, review = (window as any).__monumentReview;
        const restored = sim.loadState(structuredClone(save.settlement));
        if (!restored.ok) throw new Error(restored.reason);
        // Explicit visual neighbors only; paid Monument receipts remain the immutable supplied fixture.
        const { makeBuilding } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-placement.ts"));
        const neighborhood = sim.saveState(), context: any = { nextBuilding: neighborhood.nextBuilding, options: { world: review.world } };
        for (const [type, x, z] of [[57, 44, 33], [17, 44, 43]]) {
          const neighbor = makeBuilding(context, type, x, z);
          Object.assign(neighbor, { construction: 1, foundationProgress: 1, required: {}, input: {}, output: {}, inventory: {}, incoming: {} });
          neighborhood.buildings.push(neighbor);
          for (let row = neighbor.z - neighbor.depth / 2; row < neighbor.z + neighbor.depth / 2; row++)
            for (let column = neighbor.x - neighbor.width / 2; column < neighbor.x + neighbor.width / 2; column++)
              neighborhood.occupied[row * review.world.cellsX + column] = 1;
        }
        neighborhood.nextBuilding = context.nextBuilding;
        const authored = sim.loadState(neighborhood);
        if (!authored.ok) throw new Error(authored.reason);
        sim.setPlayerNation(nation);
        const { randomWorkerAppearances } = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-appearance.ts"));
        const appearances = randomWorkerAppearances(12, nation, () => .37);
        await review.renderer.setWorkerAppearances(appearances);
        (window as any).__settlement.setPlayerAppearances(appearances);
        const building = sim.buildings().find((site: any) => site.typeId === 7);
        const { panByScreen } = await import(/* @vite-ignore */ String("/src/render-common/camera-controller.ts"));
        (window as any).__monumentFocus = async (yaw: number, zoom = 1.6) => {
          Object.assign(review.camera, { centerX: building.x, centerZ: building.z, tilt: 0, yaw, zoom });
          const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          await frame(); await frame();
          const points = () => [-4.2, 4.2].flatMap(x => [-4.2, 4.2].flatMap(z => [-.16, height].map(y =>
            review.renderer.projectToViewport(building.x + x, building.y + y, building.z + z))));
          const before = points(), mid = (Math.min(...before.map(point => point.y)) + Math.max(...before.map(point => point.y))) / 2;
          panByScreen(review.camera, 0, mid - innerHeight / 2);
          await frame(); await frame();
          const after = points();
          return { minY: Math.min(...after.map(point => point.y)), maxY: Math.max(...after.map(point => point.y)), height: innerHeight };
        };
        const projection = await (window as any).__monumentFocus(0);
        return { projection, visualNeighbors: "authored completed residence and woodcutter; no economic completion claim", uid: building.uid, x: building.x, y: building.y, z: building.z, height,
          actualActors: sim.saveState().actors.map((actor: any) => ({ uid: actor.uid, job: actor.job, ware: actor.ware, x: actor.x, z: actor.z })) };
      }, { nation, save: saves["continuous-completed"], height: MONUMENT_ASSETS[nation].height });
      assert(state.projection.minY >= 80 && state.projection.maxY <= state.projection.height - 100, "Entire supplied building fits the native viewport");
      const expected = MONUMENT_ASSETS[nation][quality === "high" ? "high" : "minimal"];
      await page.waitForFunction(expected => {
        const stats = (window as any).__monumentReview.renderer.getStats().details;
        return stats.monumentPending === 0 && stats.monumentTriangles === expected;
      }, expected, { timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-front.png`) });
      const stats = await page.evaluate(() => (window as any).__monumentReview.renderer.getStats().details);
      await page.evaluate(() => (window as any).__monumentFocus(Math.PI));
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-rear.png`) });
      await page.evaluate(async () => { (window as any).__monumentHour = 23;
        await (window as any).__monumentFocus(0); });
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-night.png`) });
      await page.evaluate(({ x, z }) => { (window as any).__monumentHour = 12;
        Object.assign((window as any).__monumentReview.camera, { centerX: x, centerZ: z, zoom: .9 }); }, state);
      await page.waitForFunction(expected => (window as any).__monumentReview.renderer.getStats().details.monumentTriangles === expected,
        MONUMENT_ASSETS[nation].minimal, { timeout: 60_000 });
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-gameplay.png`) });
      const far = await page.evaluate(() => (window as any).__monumentReview.renderer.getStats().details);
      reports.push({ quality, nation, expected, state, stats, far, lighting: "render-only day/night environment override" });
    }
    for (const stage of ["initial", "partial", "stocked-authored-foundation"]) {
      const witness = await page.evaluate(save => {
        const sim = (window as any).__settlement.simulation;
        const loaded = sim.loadState(structuredClone(save.settlement));
        if (!loaded.ok) throw new Error(loaded.reason);
        const building = sim.buildings().find((site: any) => site.typeId === 7);
        Object.assign((window as any).__monumentReview.camera, { centerX: building.x, centerZ: building.z, yaw: 0, zoom: 1.6 });
        return { x: building.x, z: building.z, construction: building.construction, required: building.required,
          input: building.input, carriers: sim.saveState().actors.filter((actor: any) => actor.ware).map((actor: any) =>
            ({ uid: actor.uid, ware: actor.ware, x: actor.x, z: actor.z })) };
      }, saves[stage]);
      await page.waitForTimeout(450);
      await page.screenshot({ path: resolve(output, `${quality}-${stage}-piles-carriers.png`) });
      const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), witness);
      await page.mouse.click(screen.x, screen.y);
      await page.locator(".settlement-ui__building-details-window").waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForFunction(minimum => document.querySelectorAll(".settlement-ui__construction-materials tr").length >= minimum,
        stage === "partial" ? 2 : 11, { timeout: 15_000 });
      const rows = await page.locator(".settlement-ui__construction-materials tr").allTextContents();
      assert(rows.length >= (stage === "partial" ? 2 : 11));
      await page.screenshot({ path: resolve(output, `${quality}-${stage}-construction-panel.png`) });
      const icons = stage === "initial" ? await page.evaluate(async wares => {
        const { getWareIconSource } = await import(/* @vite-ignore */ String("/src/app/settlement-ui/inventory.ts"));
        const images = [...document.querySelectorAll<HTMLImageElement>(".settlement-ui__construction-materials th img")];
        return wares.map(ware => ({ ware, expected: new URL(getWareIconSource(ware), location.href).href,
          actual: images.find(image => image.src === new URL(getWareIconSource(ware), location.href).href)?.src }));
      }, ["planks", "stone", "hardwoodPlanks", "marble", "cedarPlanks", "limestone", "walnutPlanks", "basalt", "mahoganyPlanks", "granite"]) : undefined;
      if (icons) for (const icon of icons) assert.equal(icon.actual, icon.expected);
      reports.push({ quality, stage, witness, rows, icons });
      await page.getByRole("button", { name: "Close building details window", exact: true }).click();
    }
    const released = await page.evaluate(async () => {
      const renderer = (window as any).__monumentReview.renderer;
      renderer.render = () => {}; renderer.dispose();
      const { monumentAssetStats } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/monument-building.ts"));
      return monumentAssetStats();
    });
    assert.deepEqual(released, { assets: 0, pending: 0, references: 0 });
    assert.deepEqual(errors, []); reports.push({ quality, errors, released });
    writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
    await page.close();
  }
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
    writeFileSync(resolve(output, "failure.json"), JSON.stringify({ phase, errors: failureErrors, error: String(error),
      body: await activePage.locator("body").innerText().catch(() => "unavailable") }, null, 2));
  }
  throw error;
} finally { await browser.close(); await server.close(); }
console.log(`Monument native review: ${reports.length} receipts`);
