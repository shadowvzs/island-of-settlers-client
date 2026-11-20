import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * In-game check of the nation equipment: the training encounter's four troop types of every
 * player nation march out against the computer soldiers (another nation in red livery) on a clear
 * flat island; screenshots at normal and close zoom once they fight, on High and Minimal.
 * `npx tsx tools/bench/nation-equipment-native-review.ts` (NATIONS=roman,viking limits it).
 */
const output = resourcesPath("settlement-previews", "nation-equipment", "in-game");
mkdirSync(output, { recursive: true });
const nations = (process.env.NATIONS ?? "roman,viking,nubian,japanese").split(",");
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) for (const nation of nations) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(`window.__name=value=>value;
      localStorage.setItem("island-of-settlers.worker-nation", "${nation}");`);
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch(); let source = await response.text();
      const preparation = /prepareIslandWorld\(world, params, fog, revealOre, settlementEnabled \? playerNation : (?:undefined|void 0)\);/;
      assert(preparation.test(source), "fixture intercept matches current world preparation");
      source = source.replace(preparation,
        `world.heights.fill(world.seaLevel + 2); world.props.count = 0;
         world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(4);
         world.start.x = 64.5; world.start.z = 64.5;
         prepareIslandWorld(world, params, fog, revealOre, settlementEnabled ? playerNation : undefined);`);
      source = source.replace("window.__islandReady = true",
        `window.__nationCamera = camera;
         const nationRender = renderer.render.bind(renderer);
         renderer.render = frame => { window.__nationLastFrame = frame; nationRender(frame); };
         window.__islandReady = true`);
      await route.fulfill({ response, body: source });
    });
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&landform=peninsula` +
      "&mountains=0&forest=0&reveal=1&cache=0&time=day");
    await page.waitForFunction(() => !!(window as any).__islandReady, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const advance = async (seconds: number) => {
      await page.evaluate(seconds => {
        const simulation = (window as any).__settlement.simulation;
        for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
      }, seconds);
      await page.waitForTimeout(30);
    };
    const front = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      simulation.startMilitaryTrainingEncounter();
      const enemies = simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.faction === 1)
        .map((soldier: any) => simulation.frames().find((actor: any) => actor.uid === soldier.actor));
      const x = enemies.reduce((sum: number, actor: any) => sum + actor.x, 0) / enemies.length;
      const z = enemies.reduce((sum: number, actor: any) => sum + actor.z, 0) / enemies.length;
      simulation.callOutMilitary(["shield", "heavy", "archer", "cavalry"], { x, z });
      return { x, z };
    });
    // Observe the march itself: blindly advancing a minute can finish the battle before review.
    let fighting = 0;
    for (let step = 0; step < 500 && fighting === 0; step++) {
      await advance(.5);
      fighting = await page.evaluate(() => (window as any).__settlement.simulation.militarySoldiers()
        .filter((soldier: any) => (soldier.combat?.attackTime ?? 0) > 0).length);
    }
    assert(fighting > 0, `${quality}/${nation}: encounter reaches combat`);
    const subject = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      const actors = new Map(simulation.frames().map((actor: any) => [actor.uid, actor]));
      const soldiers = simulation.militarySoldiers();
      const ours = soldiers.filter((soldier: any) => soldier.combat?.faction === 0 &&
        soldier.combat.attackTime > 0 && (actors.get(soldier.actor) as any)?.visible);
      const enemies = soldiers.filter((soldier: any) => soldier.combat?.faction === 1 &&
        (actors.get(soldier.actor) as any)?.visible);
      let pair: any = null, nearest = Infinity;
      for (const own of ours) for (const enemy of enemies) {
        const a: any = actors.get(own.actor), b: any = actors.get(enemy.actor);
        const gap = Math.hypot(a.x - b.x, a.z - b.z);
        if (gap < nearest) { nearest = gap; pair = { own: a.uid, enemy: b.uid,
          gap }; }
      }
      // Freeze this actual combat state while reviewing both zooms, rather than following an
      // arbitrary soldier who may be waiting behind the fighting line.
      if (pair) simulation.update = () => {};
      return pair;
    });
    assert(subject, "a visible opposing pair is fighting");
    await page.waitForTimeout(500);
    const equipment = await page.evaluate(subject => {
      const frame = (window as any).__nationLastFrame;
      const units = [...frame.workers, ...frame.cavalryMounts];
      return [subject.own, subject.enemy].map(id => {
        const unit = units.find((entry: any) => entry.actorId === id);
        return { id, nation: unit?.nation, variant: unit?.variant ?? unit?.rider,
          faction: unit?.combat?.faction ?? unit?.faction };
      });
    }, subject);
    assert.equal(equipment[0]!.nation, nation);
    assert(equipment[1]!.nation && equipment[1]!.nation !== nation,
      "opponent uses its own nation's rendered body");
    assert.equal(equipment[0]!.faction, 0); assert.equal(equipment[1]!.faction, 1);
    for (const [name, zoom] of [["normal", 2], ["close", 5]] as const) {
      // Follow one soldier (the game keeps running) and centre it: probe how the view centre
      // moves its projection, then correct.
      await page.evaluate(async ({ subject, zoom }) => {
        const camera = (window as any).__nationCamera, live = (window as any).__settlement;
        const frame = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        const at = () => {
          const rendered = (window as any).__nationLastFrame;
          const actors = [...rendered.workers, ...rendered.cavalryMounts];
          const own = actors.find((actor: any) => actor.actorId === subject.own);
          const enemy = actors.find((actor: any) => actor.actorId === subject.enemy);
          return { x: (own.x + enemy.x) / 2, z: (own.z + enemy.z) / 2,
            y: (own.y + enemy.y) / 2 };
        };
        // Look from the enemy's side: the troops face the camera.
        Object.assign(camera, { centerX: at().x, centerZ: at().z, yaw: Math.PI, zoom });
        // Iso projection couples both world axes to both screen axes: solve them together.
        for (let pass = 0; pass < 2; pass++) {
          await frame();
          const { x, y, z } = at();
          if (![x, y, z].every(Number.isFinite)) throw new Error("Fighting pair has invalid render positions");
          const before = live.project(x, y + .5, z);
          camera.centerX += 1; await frame();
          const alongX = live.project(x, y + .5, z);
          camera.centerX -= 1; camera.centerZ += 1; await frame();
          const alongZ = live.project(x, y + .5, z);
          camera.centerZ -= 1;
          const ax = alongX.x - before.x, ay = alongX.y - before.y;
          const bx = alongZ.x - before.x, by = alongZ.y - before.y;
          const determinant = ax * by - ay * bx;
          if (Math.abs(determinant) < .01) throw new Error("Camera centering projection is singular");
          const dx = innerWidth / 2 - before.x, dy = innerHeight / 2 - before.y;
          camera.centerX += (dx * by - dy * bx) / determinant;
          camera.centerZ += (dy * ax - dx * ay) / determinant;
        }
        await frame();
      }, { front, subject, zoom });
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-${name}.png`) });
    }
    assert.deepEqual(errors, []);
    report.push({ quality, nation, fighting, subject, equipment, errors });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); await server.close(); }
