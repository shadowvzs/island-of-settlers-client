import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Building level review sheets (FUTURE-01): each sampled building at levels 1-5, side by side, at
 * a close view (top row) and the normal gameplay distance (bottom row), per nation and quality.
 * The camera is framed once on the level 5 building, so every level shares one view.
 * Env: NATIONS, QUALITIES, IDS (comma lists), OUT (folder), VIEW=back for the opposite sides.
 */
const nations = (process.env.NATIONS ?? "roman,viking,nubian,japanese").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const ids = (process.env.IDS ?? "20,33,37,57,58,59").split(",").map(Number);
const output = resolve(process.env.OUT ?? "../resources/building-levels-art-2026-10-21");
const CELL = { height: 420, width: 480 } as const;
/** Close view distance as a share of the framed distance (ZOOM < 1 inspects details). */
const zoom = Number(process.env.ZOOM ?? .85);
const back = process.env.VIEW === "back";
mkdirSync(output, { recursive: true });

interface SheetResult { png: string; triangles: number[]; name: string }

const renderSheet = async ({ back, cell, id, zoom }: {
  back: boolean; cell: typeof CELL; id: number; zoom: number
}): Promise<SheetResult> => {
  const preview = (window as any).__buildingPreview;
  preview.selectBuilding(id, 5);
  await (window as any).__buildingResidentReady;
  const Vector3 = preview.camera.position.constructor;
  const { centre: [x, y, z], radius } = preview.framing(), centre = new Vector3(x, y, z);
  const camera = preview.camera.clone();
  camera.aspect = cell.width / cell.height;
  camera.updateProjectionMatrix();
  const direction = new Vector3(4.5, 3.2, 5.5).normalize();
  if (back) { direction.x *= -1; direction.z *= -1; }
  const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.02;
  const views = [{ distance: distance * zoom, label: "close" }, { distance: distance * 1.9, label: "gameplay" }];
  const sheet = document.createElement("canvas");
  sheet.width = cell.width * 5; sheet.height = cell.height * views.length;
  const context = sheet.getContext("2d")!;
  const triangles: number[] = [];
  for (let level = 1; level <= 5; level++) {
    preview.selectBuilding(id, level);
    await (window as any).__buildingResidentReady;
    const model = preview.model();
    model.update(0, { construction: 1, door: 0, working: false, windStrength: .6, windDirection: .4 });
    triangles.push(model.triangles(false));
    views.forEach((view, row) => {
      camera.position.copy(centre).addScaledVector(direction, view.distance);
      camera.lookAt(centre);
      preview.renderer.render(preview.scene, camera);
      context.drawImage(preview.renderer.domElement, (level - 1) * cell.width, row * cell.height, cell.width,
        cell.height);
      context.fillStyle = "rgba(20,20,20,.75)";
      context.fillRect((level - 1) * cell.width, row * cell.height, 230, 26);
      context.fillStyle = "#fff";
      context.font = "15px sans-serif";
      context.fillText(`Lv${level} · ${view.label} · ${triangles.at(-1)} tris`, (level - 1) * cell.width + 8,
        row * cell.height + 18);
    });
  }
  return { name: preview.model().root.name, png: sheet.toDataURL("image/png"), triangles };
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: CELL });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const nation of nations) for (const quality of qualities) {
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    for (const id of ids) {
      const sheet = await page.evaluate(renderSheet, { back, cell: CELL, id, zoom });
      writeFileSync(resolve(output, `${nation}-${id}-${quality}.png`),
        Buffer.from(sheet.png.split(",")[1]!, "base64"));
      report.push({ id, nation, quality, triangles: sheet.triangles });
      console.log(nation, quality, id, sheet.triangles.join(" "));
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "triangles.json"), JSON.stringify(report, null, 2));
} finally { await browser.close(); await server.close(); }
