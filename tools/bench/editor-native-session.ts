import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentAction } from "./development-ui-helpers";
import { resourcesPath } from "./resources-path";

export interface EditorPoint { x: number; z: number }
export type EditorSession = Awaited<ReturnType<typeof startEditorSession>>;

/** Test-only native editor observation. Authored-map edits use visible controls; Play fixtures are explicit. */
export const startEditorSession = async (quality: string, name: string, historical = false, size = 256, entry = "") => {
  const output = resourcesPath("editor-acceptance-current", name, quality, process.env.RUN_ID ?? "current");
  mkdirSync(output, { recursive: true });
  const { server, url } = await startDevServer(), browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], rows: Record<string, unknown>[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/src/app/settlement/island-resource-hooks.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = "createIslandResourceHooks(options, stone)";
    assert(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker,
      `((typeof window === "undefined" || (window.__editorStone = stone)), ${marker})`) });
  });
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(); let source = await response.text();
    assert(source.includes("window.__islandReady = true"));
    if (historical) {
      assert(source.includes("const mapEditor = createIslandMapEditor"));
      source = source.replace("const mapEditor = createIslandMapEditor",
        "if(!startMap){window.__historicalCourses=structuredClone(world.generatedRivers);world.generatedRivers=[];}const mapEditor = createIslandMapEditor");
    }
    source = source.replace("window.__islandReady = true",
      "window.__editorReviewToken=performance.timeOrigin+':'+performance.now();" +
      "window.__editorReview={world,camera,renderer,viewport,mapEditor,growth,felling,animals,environment};window.__islandReady = true");
    await route.fulfill({ response, body: source });
  });
  const flush = () => {
    writeFileSync(resolve(output, "report.json"), JSON.stringify({ quality, historical, rows, errors }, null, 2));
  };
  const close = async () => {
    flush();
    await browser.close(); await server.close();
  };
  try {
    const forest = process.env.FOREST ?? "1", mountains = process.env.MOUNTAINS ?? "1";
    const rivers = process.env.RIVERS ?? "2";
    let checkpoint = "";
    if (process.env.EDITOR_MAP_CHECKPOINT) {
      await page.route("**/editor-checkpoint.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
      await page.goto(`${url}editor-checkpoint.html`);
      await page.evaluate(async bytes => {
        const { openMapStorage } = await import(/* @vite-ignore */ String("/src/app/map-editor/map-storage.ts"));
        const storage = await openMapStorage();
        if (!storage) throw new Error("Native checkpoint map storage is unavailable");
        try { await storage.write({ id: "acceptance-checkpoint", name: "Actual editor saved checkpoint",
          savedAt: Date.now(), size: bytes.length }, new Uint8Array(bytes)); }
        finally { storage.close(); }
      }, Array.from(readFileSync(process.env.EDITOR_MAP_CHECKPOINT)));
      checkpoint = "&map=acceptance-checkpoint";
      rows.push({ name: "resume-actual-editor-map-bytes", path: process.env.EDITOR_MAP_CHECKPOINT });
    }
    await page.goto(`${url}${entry}?quality=${quality}&size=${size}&seed=1234&rivers=${rivers}&forest=${forest}` +
      `&mountains=${mountains}&cache=0&reveal=1${checkpoint}`);
    await page.waitForFunction(() => (window as any).__islandReady, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    if (entry === "editor.html")
      await page.waitForFunction(() => (window as any).__editorReady, null, { timeout: 180000 });
    else await (await openDevelopmentAction(page, "Map editor")).click();
    await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).waitFor({ state: "visible" });
  } catch (error) {
    rows.push({ name: "startup-failed", entry, error: error instanceof Error ? error.stack : String(error) });
    writeFileSync(resolve(output, "failure-body.txt"), await page.locator("body").innerText().catch(() => "unavailable"));
    await page.screenshot({ path: resolve(output, "failure.png"), timeout: 10000 }).catch(() => {});
    await close(); throw error;
  }
  const button = (name: string) => page.getByRole("button", { exact: true, name });
  const runtimeToken = () => page.evaluate(() => String((window as any).__editorReviewToken));
  const waitForRuntime = (previous: string) => page.waitForFunction(previous =>
    Boolean((window as any).__editorReviewToken && (window as any).__editorReviewToken !== previous &&
    (window as any).__islandReady && ((window as any).__editorReady || (window as any).__settlement?.saving)),
  previous, { timeout: 180000 });
  const idle = async () => {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => !(window as any).__terrainStats?.busy, null, { timeout: 120000 });
  };
  const digest = () => page.evaluate(async () => {
    const { digestWorld } = await import(/* @vite-ignore */ String("/tools/bench/map-editor-terrain-probe.ts"));
    const { mapEditor, world } = (window as any).__editorReview;
    return { ...await digestWorld(world), scenario: JSON.stringify(world.scenario ?? null),
      environment: JSON.stringify(world.environmentDefaults ?? null),
      treeAges: JSON.stringify(world.authoredTreeAges ?? {}),
      animals: JSON.stringify(mapEditor.saveInput().animals) };
  });
  const focus = async (point: EditorPoint, zoom = 1) => {
    await page.evaluate(([p, z]) => {
      if ((window as any).__editorReady)
        Object.assign((window as any).__editorReview.camera, { centerX: p.x, centerZ: p.z, zoom: z });
      else (window as any).__settlement.focusGround(p.x, p.z, z);
    }, [point, zoom] as const);
    await page.waitForTimeout(350);
  };
  const project = (point: EditorPoint) => page.evaluate(async p => {
    if (!(window as any).__editorReady) return (window as any).__settlement.projectGround(p.x, p.z);
    const { renderer, world } = (window as any).__editorReview;
    const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
    return renderer.projectToViewport(p.x, sampleSmooth(world, world.heights, p.x, p.z), p.z);
  }, point) as Promise<{ x: number; y: number }>;
  const click = async (point: EditorPoint) => {
    await focus(point); const screen = await project(point);
    assert(screen.x > 430 && screen.x < 1440 && screen.y > 40 && screen.y < 950);
    await page.mouse.click(screen.x, screen.y); await idle();
  };
  const drag = async (points: EditorPoint[]) => {
    await focus(points[Math.floor(points.length / 2)]!, .6);
    const screens = await Promise.all(points.map(project));
    assert(screens.every(p => p.x > 430 && p.x < 1440 && p.y > 40 && p.y < 950));
    await page.mouse.move(screens[0]!.x, screens[0]!.y); await page.mouse.down();
    for (const p of screens.slice(1)) { await page.mouse.move(p.x, p.y, { steps: 3 }); await page.waitForTimeout(20); }
    await page.mouse.up(); await idle();
  };
  const step = async (name: string, action: () => Promise<void>, changed = true, capture = true) => {
    const before = await digest(), started = Date.now();
    await action(); await idle(); const after = await digest();
    const actionHint = await page.locator(".map-editor__status").textContent();
    assert.equal(JSON.stringify(before) !== JSON.stringify(after), changed, `${name}: ${actionHint}`);
    if (changed) {
      await button("Undo (Ctrl+Z)").click(); await idle(); assert.deepEqual(await digest(), before, `${name} undo`);
      await button("Redo (Ctrl+Y / Ctrl+Shift+Z)").click(); await idle();
      assert.deepEqual(await digest(), after, `${name} redo`);
    }
    const hint = await page.locator(".map-editor__status").textContent();
    rows.push({ name, changed, exactHistory: changed, elapsedMs: Date.now() - started, hint, after });
    console.log(JSON.stringify({ name, changed, exactHistory: changed, hint, elapsedMs: Date.now() - started }));
    if (capture) await page.screenshot({ path: resolve(output, `${name}.png`) });
    flush();
  };
  const save = async () => {
    const before = await digest();
    await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
    await button("Save in the browser (new slot)").click(); await page.waitForTimeout(1500);
    const checkpoint = await page.evaluate(async () => {
      const { openMapStorage } = await import(/* @vite-ignore */ String("/src/app/map-editor/map-storage.ts"));
      const storage = await openMapStorage();
      if (!storage) throw new Error("Native map storage is unavailable");
      try {
        const slot = (await storage.list())[0], bytes = slot && await storage.read(slot.id);
        if (!slot || !bytes) throw new Error("The native saved map is missing");
        return { bytes: Array.from(bytes) as number[], slot };
      } finally { storage.close(); }
    });
    writeFileSync(resolve(output, "authored-map.bin"), Uint8Array.from(checkpoint.bytes));
    rows.push({ name: "native-map-byte-checkpoint", slot: checkpoint.slot }); flush();
    const previous = await runtimeToken();
    page.once("dialog", dialog => void dialog.accept()); await button("Load this map").first().click();
    await page.waitForURL(/map=/, { timeout: 60000 });
    await waitForRuntime(previous);
    assert.deepEqual(await digest(), before, "Every measured layer survives native map save/reload");
    rows.push({ name: "native-save-reload", exact: true }); assert.deepEqual(errors, []);
  };
  return { button, click, close, digest, drag, errors, flush, focus, idle, output, page, rows,
    runtimeToken, save, step, waitForRuntime };
};

export const terrainTab = (page: Page) =>
  page.getByRole("tab", { exact: true, name: "Relief and water" }).click();

/** Picks a decoration palette tile by its name (all categories, empty search) with its place tool active. */
export const selectPaletteDecoration = async (page: Page, name: string) => {
  await page.getByRole("searchbox", { name: "Search decorations", exact: true }).fill("");
  await page.getByRole("group", { name: "Decoration categories", exact: true })
    .getByRole("button", { name: "All", exact: true }).click();
  const tile = page.getByRole("group", { name: "Decoration palette", exact: true })
    .getByRole("button", { name, exact: true });
  if (await tile.getAttribute("aria-pressed") !== "true") { await tile.click(); return; }
  const place = page.getByRole("button", { name: "Place decoration on map", exact: true });
  if (await place.getAttribute("aria-pressed") !== "true") await place.click();
};
