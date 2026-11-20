import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "icons-ui-d";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "hostile-catapult-2026-11-04", run);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], icons: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/hostile-icons.html", route => route.fulfill({
    contentType: "text/html", body: "<body></body>"
  }));
  await page.goto(`${url}hostile-icons.html`);
  for (const variant of ["bandit", "pirate"] as const) {
    const result = await page.evaluate(async variant => {
      const { hostileCatapultIcon } = await import(/* @vite-ignore */ String("/tools/bench/hostile-catapult-icon-scene.ts"));
      return hostileCatapultIcon(variant);
    }, variant);
    const png = Buffer.from(result.png, "base64");
    writeFileSync(resolve("assets/building-icons", `hostile-catapult-${variant}.png`), png);
    writeFileSync(resolve(output, `${variant}-icon.png`), png);
    icons.push({ variant, triangles: result.triangles, calls: result.calls, bytes: png.byteLength });
  }
  await page.route("**/hostile-editor.html", route => route.fulfill({ contentType: "text/html", body: `
    <style>body{display:flex;gap:16px;margin:12px;background:#ddd;font:14px system-ui}
      #panel{width:440px;height:850px;overflow:auto}#panel label{display:grid;grid-template-columns:1fr 160px;margin:8px}
      #map{position:relative;width:640px;height:640px;background:#a4b58d;border:1px solid #666}
      #panel button img{max-width:32px;max-height:32px}#panel button{margin:4px;padding:6px}</style>
    <aside id="panel"></aside><div aria-label="Fixture map" id="map"></div>` }));
  await page.goto(`${url}hostile-editor.html`);
  await page.evaluate(async () => {
    const { setupHostileCatapultEditor } =
      await import(/* @vite-ignore */ String("/tools/bench/hostile-catapult-editor-scene.ts"));
    (window as any).__hostileEditor = setupHostileCatapultEditor();
  });
  const field = (label: string) => page.getByLabel(label, { exact: true });
  for (const [variant, faction, stones, x] of [["bandit", "2", "6", 285], ["pirate", "3", "4", 445]] as const) {
    await field("Enemy building").selectOption(`${variant}-catapult`);
    await field("Enemy faction").fill(faction);
    await field("Initial Catapult stones (finite)").fill(stones);
    await page.getByRole("button", { name: "Place enemy building", exact: true }).click();
    await page.locator("#map").click({ position: { x, y: 165 } });
  }
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(
    ".map-editor__scenario-overlay img")].filter(image => image.src.includes("hostile-catapult-")).length === 2);
  const previews = await page.locator(".map-editor__scenario-overlay img").evaluateAll(images =>
    images.filter(image => image.getAttribute("src")?.includes("hostile-catapult-"))
      .map(image => ({ src: (image as HTMLImageElement).src, width: (image as HTMLImageElement).naturalWidth })));
  assert(previews.some(preview => preview.src.includes("hostile-catapult-bandit.png")));
  assert(previews.some(preview => preview.src.includes("hostile-catapult-pirate.png")));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(
    ".map-editor__scenario-overlay img")].every(image => image.complete && image.naturalWidth > 0));
  const runtime = await page.evaluate(() => (window as any).__hostileEditor.verify());
  assert.deepEqual(runtime.diagnostics, []);
  // Optional undefined UI fields are deliberately omitted by the canonical JSON map format.
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.authored)), runtime.restored);
  assert.deepEqual(runtime.reload, { ok: true });
  assert.equal(runtime.friendlyPeople, 0);
  assert.equal(runtime.towers.length, 2);
  assert.deepEqual(runtime.authored.buildings.map((entry: any) => ({
    catapult: entry.catapult, defenders: entry.defenders, faction: entry.faction, type: entry.type,
    x: entry.x, z: entry.z
  })), [
    { catapult: { variant: "bandit", stones: 6 }, defenders: 2, faction: 2, type: 16, x: 28.5, z: 16.5 },
    { catapult: { variant: "pirate", stones: 4 }, defenders: 2, faction: 3, type: 16, x: 44.5, z: 16.5 }
  ]);
  for (const tower of runtime.towers) {
    const initial = tower.variant === "bandit" ? 6 : 4;
    assert.equal(tower.faction, tower.variant === "bandit" ? 2 : 3);
    assert.equal(tower.roof, 2);
    assert.equal(tower.ground, initial - 2);
    assert.equal(tower.staff.job, "Carrier");
    assert.equal(tower.staff.hostileCivilianFaction, tower.faction);
    assert.equal(tower.crew.length, 2);
    assert(tower.crew.every((soldier: any) => soldier.actor !== tower.staff.uid));
    assert(tower.crew.some((soldier: any) => soldier.combat.type === "heavy"));
  }
  await page.screenshot({ path: resolve(output, "actual-editor-controls.png") });
  await page.evaluate(() => (window as any).__hostileEditor.dispose());
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, icons, previews, runtime }, null, 2));
  console.log(JSON.stringify({ output, errors, icons, previews, towers: runtime.towers }, null, 2));
} finally {
  await browser.close(); await server.close();
}
