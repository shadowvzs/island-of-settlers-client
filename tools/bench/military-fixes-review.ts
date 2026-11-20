import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native review of two military fixes on a large forested island, High and Minimal:
 * a mixed cavalry/infantry group reversing (drawn positions must never step back and forth)
 * and a march across the island (130+ tiles). (The coastal raiders' livery check went with the
 * retired coastal defence, POLICY-01.)
 * Run: `npx tsx tools/bench/military-fixes-review.ts` (QUALITIES=minimal limits it).
 */
const output = resolve(process.env.OUTPUT ?? "../resources/settlement-previews/military-fixes");
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>;
type Point = { x: number; z: number };


/** Points the camera at the middle of the given soldiers. */
const focusGroup = (page: Page, ids: number[], zoom: number) => page.evaluate(({ ids, zoom }) => {
  const bodies = (window as any).__settlement.simulation.frames().filter((actor: any) => ids.includes(actor.uid));
  const centre = bodies.reduce((sum: Point, actor: any) => ({ x: sum.x + actor.x / bodies.length,
    z: sum.z + actor.z / bodies.length }), { x: 0, z: 0 });
  Object.assign((window as any).__fixCamera, { centerX: centre.x, centerZ: centre.z, zoom });
}, { ids, zoom });

const advance = (page: Page, seconds: number) => page.evaluate(seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
}, seconds);

/** Own field soldiers of the given types, nearest the headquarters first. */
const fieldSoldiers = (page: Page, types: string[]) => page.evaluate(types => {
  const simulation = (window as any).__settlement.simulation;
  const bodies = new Map(simulation.frames().map((actor: any) => [actor.uid, actor]));
  return simulation.militarySoldiers().filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0 &&
    types.includes(soldier.combat?.type) && (bodies.get(soldier.actor) as any)?.phase === "militaryField")
    .map((soldier: any) => soldier.actor) as number[];
}, types);

/** Drawn (smoothed) positions every animation frame while the game runs in real time. */
const recordDrawnMotion = (page: Page, ids: number[], milliseconds: number) => page.evaluate(({ ids, milliseconds }) =>
  new Promise<{ frames: number; reversals: Record<number, number> }>(done => {
    const last = new Map<number, { x: number; z: number; dx: number; dz: number }>();
    const reversals: Record<number, number> = {};
    let frames = 0;
    const started = performance.now();
    const sample = () => {
      const frame = (window as any).__fixLastFrame;
      const drawn = [...frame.cavalryMounts.map((mount: any) => ({ id: mount.actorId, x: mount.x, z: mount.z })),
        ...frame.workers.map((worker: any) => ({ id: worker.actorId, x: worker.x, z: worker.z }))];
      for (const body of drawn.filter(entry => ids.includes(entry.id))) {
        const previous = last.get(body.id) ?? { x: body.x, z: body.z, dx: 0, dz: 0 };
        const dx = body.x - previous.x, dz = body.z - previous.z, step = Math.hypot(dx, dz);
        if (step > 2e-3) {
          if (dx * previous.dx + dz * previous.dz < -.3 * step * Math.hypot(previous.dx, previous.dz))
            reversals[body.id] = (reversals[body.id] ?? 0) + 1;
          previous.dx = dx; previous.dz = dz;
        }
        previous.x = body.x; previous.z = body.z;
        last.set(body.id, previous);
      }
      frames++;
      if (performance.now() - started < milliseconds) requestAnimationFrame(sample);
      else done({ frames, reversals });
    };
    requestAnimationFrame(sample);
  }), { ids, milliseconds });

/**
 * The clearest dry ground 30 × 12 tiles near the headquarters: no water or building, and the
 * fewest trunks and large rocks (broadleaf, conifer, palm, large rock, sapling, birch).
 */
const openGround = (page: Page) => page.evaluate(() => {
  const world = (window as any).__fixWorld, simulation = (window as any).__settlement.simulation;
  const { access } = simulation.headquarters, props = world.props;
  const isDry = (cx: number, cz: number) => {
    for (let z = Math.floor(cz - 6); z <= cz + 6; z++) for (let x = Math.floor(cx - 15); x <= cx + 15; x++)
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ || !world.walkCost[z * world.cellsX + x] ||
        simulation.isOccupied(x + .5, z + .5)) return false;
    return true;
  };
  const blockers = (cx: number, cz: number) => {
    let count = 0;
    for (let index = 0; index < props.count; index++)
      if ([0, 1, 2, 5, 15, 18].includes(props.types[index]) &&
        Math.abs(props.x[index] - cx) < 16.5 && Math.abs(props.z[index] - cz) < 7.5) count++;
    return count;
  };
  let best: { blockers: number; x: number; z: number } | null = null;
  for (let radius = 16; radius <= 90; radius += 3)
    for (let step = 0; step < 24; step++) {
      const angle = step * Math.PI / 12;
      const x = Math.round(access.x + Math.cos(angle) * radius) + .5;
      const z = Math.round(access.z + Math.sin(angle) * radius) + .5;
      if (!isDry(x, z)) continue;
      const count = blockers(x, z);
      if (!best || count < best.blockers) best = { blockers: count, x, z };
    }
  return best;
});

/**
 * A target across the island: of the open ground reachable from the headquarters (5 × 5 walkable
 * blocks), the tile furthest in a straight line whose 9 × 9 block is open, 12+ tiles from the edge.
 */
const farthestReachable = (page: Page) => page.evaluate(() => {
  const world = (window as any).__fixWorld, simulation = (window as any).__settlement.simulation;
  const { access } = simulation.headquarters, width = world.cellsX;
  const isOpen = (x: number, z: number, half: number) => {
    for (let oz = -half; oz <= half; oz++) for (let ox = -half; ox <= half; ox++)
      if (!world.walkCost[(z + oz) * width + x + ox]) return false;
    return true;
  };
  const start = Math.floor(access.z) * width + Math.floor(access.x);
  const reached = new Uint8Array(width * world.cellsZ);
  const queue = [start]; reached[start] = 1;
  let best = { straight: 0, x: access.x, z: access.z };
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, x = cell % width, z = Math.floor(cell / width);
    const straight = Math.hypot(x + .5 - access.x, z + .5 - access.z);
    const inland = x >= 12 && z >= 12 && x < width - 12 && z < world.cellsZ - 12;
    if (straight > best.straight && inland && isOpen(x, z, 4)) best = { straight, x: x + .5, z: z + .5 };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * width + nx;
      if (nx < 5 || nz < 5 || nx >= width - 5 || nz >= world.cellsZ - 5 || reached[next]) continue;
      if (!isOpen(nx, nz, 2)) continue;
      reached[next] = 1; queue.push(next);
    }
  }
  return best;
});

const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch(), text = await response.text();
      await route.fulfill({ response, body: text
        .replace("prepareIslandWorld(world, params, fog, revealOre,",
          "window.__fixWorld = world; prepareIslandWorld(world, params, fog, revealOre,")
        .replace("window.__islandReady = true", `window.__fixCamera = camera;
          const fixRender = renderer.render.bind(renderer);
          renderer.render = frame => { window.__fixLastFrame = frame; fixRender(frame); };
          window.__islandReady = true`) });
    });
    await page.goto(`${url}?quality=${quality}&seed=77&size=256&landform=peninsula&mountains=1&forest=0` +
      "&reveal=1&cache=0&time=day");
    await page.waitForFunction(() => !!(window as any).__islandReady, null, { timeout: 240000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const shot = (name: string) => page.screenshot({ path: resolve(output, `${quality}-${name}.png`) });
    // Six riders and six swordsmen arrive in the headquarters' reserve.
    await page.evaluate(() => (window as any).__settlement.simulation.receiveTroops([
      ...Array.from({ length: 6 }, () => ({ hp: 105, rank: 1, type: "cavalry" })),
      ...Array.from({ length: 6 }, () => ({ hp: 125, rank: 1, type: "shield" }))]));

    // 1. Reverse jitter: six riders and six swordsmen march east, then are ordered back west.
    const open = await openGround(page);
    assert(open, "open ground near the headquarters");
    const rally = { x: open.x - 8, z: open.z };
    const called = await page.evaluate(rally => {
      const simulation = (window as any).__settlement.simulation;
      const stored = (type: string) => simulation.militaryStoredTroops()
        .find((entry: any) => entry.type === type).actors.slice(0, 6) as number[];
      const ids = [...stored("cavalry"), ...stored("shield")];
      simulation.commandMilitary(ids, rally, "move");
      return ids;
    }, rally);
    await advance(page, 120);
    // Places of the block on trees or buildings are left out: the rest of the group marches.
    const group = (await fieldSoldiers(page, ["cavalry", "shield"])).filter(id => called.includes(id));
    assert(group.length >= 8, `a mixed group stands in the field (${group.length})`);
    const ordered = await page.evaluate(({ group, rally }) => {
      const simulation = (window as any).__settlement.simulation;
      simulation.selectMilitary(group);
      return simulation.commandMilitary(group, { x: rally.x + 16, z: rally.z }, "move");
    }, { group, rally });
    assert(ordered, "the group accepts the eastward order");
    await advance(page, 4);
    const reversed = await page.evaluate(({ group, rally }) => (window as any).__settlement.simulation
      .commandMilitary(group, { x: rally.x - 6, z: rally.z }, "move"), { group, rally });
    assert(reversed, "the group accepts the reversed order");
    await focusGroup(page, group, 2);
    // The ordered about-turn itself is one change of direction; jitter is any after it.
    await page.waitForTimeout(400);
    const motion = await recordDrawnMotion(page, group, 2500);
    await shot("1-reversal-march");
    const after = await recordDrawnMotion(page, group, 6000);
    await focusGroup(page, group, 2);
    await page.waitForTimeout(800);
    await shot("2-reversal-arrived");
    report[`${quality}-reversal`] = { during: motion, after };
    // A single side step for a passing rider is traffic; stepping back and forth again is jitter.
    const oscillating = group.filter(id => (motion.reversals[id] ?? 0) + (after.reversals[id] ?? 0) > 1);
    assert.deepEqual(oscillating, [], "no soldier is drawn stepping back and forth");

    // 2. Across the island: the whole group to the furthest reachable open ground.
    const far = await farthestReachable(page);
    assert(far.straight >= 130, `a target 130+ tiles away (${far.straight.toFixed(0)})`);
    // Baseline: the slowest simulation tick over a minute while the group stands.
    const idle = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      let slowest = 0, over16 = 0;
      for (let tick = 0; tick < 20 * 60; tick++) {
        const started = performance.now();
        simulation.update(.05);
        const spent = performance.now() - started;
        slowest = Math.max(slowest, spent); if (spent > 16) over16++;
      }
      return { over16, slowestTickMs: slowest };
    });
    const timing = await page.evaluate(({ far, group }) => {
      const simulation = (window as any).__settlement.simulation;
      const started = performance.now();
      const accepted = simulation.commandMilitary(group, { x: far.x, z: far.z }, "move");
      return { accepted, milliseconds: performance.now() - started };
    }, { far, group });
    assert(timing.accepted, "the far order is accepted");
    const march = await page.evaluate(({ far, group }) => {
      const simulation = (window as any).__settlement.simulation;
      // A soldier has arrived once it stands in its place (its order's destination is cleared).
      const ordered = () => simulation.militarySoldiers().filter((soldier: any) =>
        group.includes(soldier.actor) && soldier.combat?.destination).length;
      let slowest = 0, ticks = 0, over16 = 0;
      for (; ticks < 20 * 600 && ordered(); ticks++) {
        const started = performance.now();
        simulation.update(.05);
        const spent = performance.now() - started;
        slowest = Math.max(slowest, spent); if (spent > 16) over16++;
      }
      const bodies = simulation.frames().filter((actor: any) => group.includes(actor.uid));
      return { over16, seconds: ticks / 20, slowestTickMs: slowest, unarrived: ordered(),
        distances: bodies.map((actor: any) => Math.round(Math.hypot(actor.x - far.x, actor.z - far.z))) };
    }, { far, group });
    report[`${quality}-long-route`] = { far, idle, march, timing };
    assert.equal(march.unarrived, 0, "every soldier arrives across the island");
    await focusGroup(page, group, 2);
    await page.waitForTimeout(1200);
    await shot("3-across-island");

    report[`${quality}-errors`] = errors;
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
