import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Building showcase review: every listed building and nation from four sides, High and Minimal,
 * at the normal preview distance and close up on the walls (`CLOSE`, a distance factor).
 * Env: BUILDINGS, NATIONS, QUALITIES, OUT, CLOSE (default 0.55), CLOSE_FOCUS, CLOSE_LIFT,
 * YAWS (default 45,135,225,315).
 */
const BUILDINGS = process.env.BUILDINGS?.split(",").map(Number) ?? [2];
const NATIONS = process.env.NATIONS?.split(",") ?? ["roman", "viking", "nubian", "japanese"];
const QUALITIES = process.env.QUALITIES?.split(",") ?? ["high", "minimal"];
const YAWS = process.env.YAWS?.split(",").map(Number) ?? [45, 135, 225, 315];
const CLOSE = Number(process.env.CLOSE ?? .55);
/** Close views: look-at height (share of the preview target) and camera height (share of the preview's). */
const CLOSE_FOCUS = Number(process.env.CLOSE_FOCUS ?? .5);
const CLOSE_LIFT = Number(process.env.CLOSE_LIFT ?? CLOSE);
const output = resolve(process.env.OUT ?? "../resources/settlement-previews/model-fixes");
mkdirSync(output, { recursive: true });

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const nation of NATIONS) for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = (value) => value;");
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}&building=${BUILDINGS[0]}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    for (const id of BUILDINGS) {
      const triangles = await page.evaluate(id => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id);
        return preview.model().triangles(false);
      }, id);
      console.log(`${nation} ${id} ${quality}: ${triangles}`);
      const base = await page.evaluate(() => {
        const camera = (window as any).__buildingPreview.camera;
        return [camera.position.x, camera.position.y, camera.position.z];
      });
      for (const [label, factor, focus, lift] of [["normal", 1, 1, 1], ["close", CLOSE, CLOSE_FOCUS, CLOSE_LIFT]] as const)
        for (const yaw of YAWS) {
          await page.evaluate(({ base, factor, focus, lift, yaw }) => {
            const preview = (window as any).__buildingPreview, camera = preview.camera;
            const orbit = preview.controls?.target ?? { x: 0, y: 1.3, z: 0 };
            const target = { x: orbit.x, y: orbit.y * focus, z: orbit.z };
            const dx = base[0] - target.x, dy = base[1] - target.y, dz = base[2] - target.z;
            const distance = Math.hypot(dx, dz) * factor, angle = yaw * Math.PI / 180;
            camera.position.set(target.x + Math.sin(angle) * distance, target.y + dy * lift,
              target.z + Math.cos(angle) * distance);
            camera.lookAt(target.x, target.y, target.z);
            preview.model().update(1, { construction: 1, door: 0, playerColor: [.75, .12, .06], working: false,
              windDirection: .6, windStrength: .6 });
            preview.renderer.render(preview.scene, preview.camera);
          }, { base, factor, focus, lift, yaw });
          await page.screenshot({ path: resolve(output, `${nation}-${id}-${quality}-${label}-${yaw}.png`) });
        }
    }
    if (errors.length) console.error(nation, quality, errors);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
