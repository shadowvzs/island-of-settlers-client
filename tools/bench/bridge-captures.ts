import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * In-game bridge captures: wood and stone, one straight and one angled crossing each, on a
 * generated river, with stone roads on both shores. Bridges are placed through a loaded save
 * (completed deck segments from `previewBridge`), the same plan the Road tab builds.
 * Run: SEED=123 OUTPUT=<dir> npx tsx tools/bench/bridge-captures.ts [--possess | --overlay]
 * `--overlay` captures the Road-tab bridge placement overlay (valid crossings) and a snapped hover.
 * `--life` lets the simulation run: a squad of foot soldiers crossing the stone deck.
 * `--commander` recruits the commander, rides him over the stone deck, then possesses him on it.
 * `--grounded` shoots every stone bridge (short slab, straight and angled arch) from the four iso
 * rotations at a flat close angle, plus a possessed view from the bank under the span.
 * `--panel` shoots every bridge at levels 1–5 (tier finish and detail), then clicks a bridge: hover and
 * selection outline, the bridge panel and its upgrade confirmation, and a removal under a marching squad.
 * `--v2` shoots the wooden tiers at levels 1–5, a removal pending under a squad on the deck, the reverse
 * dismantling stages and a cut-off carrier fading back to the headquarters (a load resolves its wait).
 */
const output = resolve(process.env.OUTPUT ?? "../../captures/bridges");
mkdirSync(output, { recursive: true });
const seed = process.env.SEED ?? "123";
const possess = process.argv.includes("--possess");
const overlay = process.argv.includes("--overlay");
const grounded = process.argv.includes("--grounded");
const life = process.argv.includes("--life");
const commanderRun = process.argv.includes("--commander");
const panel = process.argv.includes("--panel");
const v2 = process.argv.includes("--v2");
const ends = process.argv.includes("--ends");
const rampGap = process.argv.includes("--ramp-gap");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");

const frames = (page: Page, count = 3) => page.evaluate(async total => {
  for (let index = 0; index < total; index += 1)
    await new Promise(done => requestAnimationFrame(done));
}, count);

const placeBridges = (page: Page) => page.evaluate(() => {
  const { world } = (window as any).__bridgeWorld;
  const live = (window as any).__settlement, sim = live.simulation;
  live.realUpdate = sim.update;
  sim.update = () => {};
  const plans: Record<string, any> = {};
  const used: any[] = [];
  const straight = (plan: any) => plan.start.x === plan.end.x || plan.start.z === plan.end.z;
  const clear = (plan: any) => used.every(other => Math.hypot(plan.start.x - other.start.x,
    plan.start.z - other.start.z) > (plan.tiles <= 3 ? 6 : 9));
  const wanted = [["wood-straight", "wood", true, 5], ["stone-angled", "stone", false, 5],
    ["stone-straight", "stone", true, 5], ["wood-angled", "wood", false, 5],
    ["stone-slab", "stone", null, 3]] as const;
  const candidates: { x: number; z: number }[] = [];
  for (let z = 2; z < 94; z += 1) for (let x = 2; x < 94; x += 1)
    if (Math.hypot(x - sim.headquarters.x, z - sim.headquarters.z) < 45 &&
      world.blocking[z * world.cellsX + x] === 1) candidates.push({ x: x + .5, z: z + .5 });
  for (const [name, kind, wantStraight, minimum] of wanted) {
    const maximum = minimum === 3 ? 3 : 12;
    for (const pointer of candidates) {
      const { plan } = sim.previewBridge(pointer, kind);
      if (!plan || (wantStraight !== null && straight(plan) !== wantStraight) || plan.tiles < minimum || plan.tiles > maximum ||
        !clear(plan)) continue;
      plans[name] = plan; used.push(plan); break;
    }
  }
  const save = sim.saveState();
  const roads = [];
  let nextId = 1;
  for (const plan of Object.values(plans)) {
    const id = nextId++;
    roads.push(...plan.segments.map((segment: any) => ({ ...segment, bridge: { ...segment.bridge, id } })));
    for (const [anchor, other] of [[plan.start, plan.end], [plan.end, plan.start]]) {
      const dx = anchor.x - other.x, dz = anchor.z - other.z;
      const stepX = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) * .5 : 0;
      const stepZ = stepX ? 0 : Math.sign(dz) * .5;
      for (let index = 0; index < 8; index += 1)
        roads.push({ tier: "stone", start: { x: anchor.x + stepX * index, z: anchor.z + stepZ * index },
          end: { x: anchor.x + stepX * (index + 1), z: anchor.z + stepZ * (index + 1) } });
    }
  }
  save.roads = roads;
  const loaded = sim.loadState(save);
  return { loaded, plans: Object.fromEntries(Object.entries(plans).map(([name, plan]: any) =>
    [name, { start: plan.start, end: plan.end, tiles: plan.tiles }])) };
});

type Plan = { start: { x: number; z: number }; end: { x: number; z: number } };

/** Possessed eye on the first shore looking along the deck: eye view, spyglass, mid-deck view. */
const capturePossessed = async (page: Page, quality: string, name: string, plan: Plan) => {
  const [dx, dz] = [plan.end.x - plan.start.x, plan.end.z - plan.start.z];
  const length = Math.hypot(dx, dz), targetYaw = Math.atan2(dx, dz);
  const approach = { x: plan.start.x - dx / length * 3, z: plan.start.z - dz / length * 3 };
  await page.evaluate(([x, z]) => (window as any).__settlement.focusGround(x, z, 1), [approach.x, approach.z]);
  await frames(page, 10);
  const entered = await page.evaluate(() => (window as any).__exploration.controller.enter());
  console.log(name, "enter", JSON.stringify(entered));
  if (!(entered as any).ok) return;
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
    null, { timeout: 60_000 });
  const pose = () => page.evaluate(() => {
    const p = (window as any).__exploration.controller.frame().camera?.pose;
    return p && { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
  });
  const turn = async () => {
    for (let step = 0; step < 120; step += 1) {
      const error = await page.evaluate(target => {
        const current = (window as any).__exploration.controller.frame().camera.pose.yaw;
        let delta = target - current;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        (window as any).__exploration.controller.setLook(Math.max(-3, Math.min(3, delta * 4)), 0);
        return delta;
      }, targetYaw);
      if (Math.abs(error) < .02) break;
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => (window as any).__exploration.controller.setLook(0, 0));
  };
  const walkTo = async (distance: number) => {
    const goal = { x: plan.start.x + dx / length * distance, z: plan.start.z + dz / length * distance };
    for (let step = 0; step < 200; step += 1) {
      const here = (await pose())!;
      if (Math.hypot(goal.x - here.x, goal.z - here.z) < .4) break;
      await page.evaluate(() => (window as any).__exploration.controller.setMovement(1, 0));
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => (window as any).__exploration.controller.setMovement(0, 0));
  };
  await turn();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, `${quality}-${name}-possessed-shore.png`) });
  await page.evaluate(() => (window as any).__exploration.controller.toggleSpyglass());
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, `${quality}-${name}-possessed-spyglass.png`) });
  await page.evaluate(() => (window as any).__exploration.controller.toggleSpyglass());
  await walkTo(length * .45);
  await turn();
  await page.waitForTimeout(400);
  console.log(name, "pose", JSON.stringify(await pose()));
  await page.screenshot({ path: resolve(output, `${quality}-${name}-possessed-deck.png`) });
  await page.evaluate(() => (window as any).__exploration.controller.forceExit("leave"));
  await page.waitForFunction(() => ["idle", "cooldown"].includes((window as any).__exploration.controller.phase()),
    null, { timeout: 60_000 });
  await page.waitForTimeout(500);
};

/** Bridge tool active over the river near the stone crossing: the overlay, then a snapped hover. */
const captureOverlay = async (page: Page, quality: string, plan: Plan) => {
  const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
  await page.evaluate(([cx, cz]) => {
    const live = (window as any).__settlement;
    live.focusGround(cx, cz, .75);
    live.controls.selectRoad("bridge-stone");
  }, [x, z]);
  await page.mouse.move(5, 450);
  // The spot scan is time sliced (2 ms per frame): give it time to finish before the shot.
  await frames(page, 240);
  await page.screenshot({ path: resolve(output, `${quality}-overlay-iso.png`) });
  const hover = await page.evaluate(([cx = 0, cz = 0]) => {
    const live = (window as any).__settlement, sim = live.simulation;
    for (let radius = 4; radius < 30; radius += 1) for (let step = 0; step < 24; step += 1) {
      const angle = step / 24 * Math.PI * 2;
      const pointer = { x: Math.round((cx + Math.cos(angle) * radius) * 2) / 2,
        z: Math.round((cz + Math.sin(angle) * radius) * 2) / 2 };
      const preview = sim.previewBridge(pointer, "stone");
      if (!preview.plan || preview.reason === "bridge-overlaps-road") continue;
      const { end, start } = preview.plan;
      // Hover beside the deck centre (on the bank side), so the overlay has to snap to it.
      const mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
      return live.projectGround(mid.x * .7 + start.x * .3, mid.z * .7 + start.z * .3);
    }
    return null;
  }, [x, z]);
  if (!hover) return;
  await page.mouse.move(hover.x, hover.y);
  await frames(page, 30);
  await page.screenshot({ path: resolve(output, `${quality}-overlay-hover.png`) });
  await page.evaluate(() => (window as any).__settlement.controls.cancel?.());
};

/** Four iso rotations at a flat, close angle: any floating stone or gap to the bank shows. */
const captureGrounded = async (page: Page, quality: string, name: string, plan: Plan) => {
  const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
  for (let turn = 0; turn < 4; turn += 1) {
    await page.evaluate(([cx = 0, cz = 0, yaw = 0]) => {
      const { camera } = (window as any).__bridgeWorld;
      (window as any).__settlement.focusGround(cx, cz, 2.6);
      camera.yaw = yaw;
      camera.tilt = -0.5;
    }, [x, z, turn * Math.PI / 2 + 0.35]);
    await frames(page, 14);
    await page.screenshot({ path: resolve(output, `${quality}-${name}-side-${turn}.png`) });
  }
  await page.evaluate(() => { const { camera } = (window as any).__bridgeWorld; camera.yaw = 0; camera.tilt = 0; });
};

/** Possessed eye on the bank beside the span, looking along the river under the deck. */
const capturePossessedUnder = async (page: Page, quality: string, name: string, plan: Plan) => {
  const [dx, dz] = [plan.end.x - plan.start.x, plan.end.z - plan.start.z];
  const length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
  const spots = [-4.5, 4.5].flatMap(side => [0.15, 0.85].map(along => ({
    x: plan.start.x + dx * along - uz * side, z: plan.start.z + dz * along + ux * side, side })));
  for (const spot of spots) {
    await page.evaluate(([px, pz]) => (window as any).__settlement.focusGround(px, pz, 1), [spot.x, spot.z]);
    await frames(page, 10);
    const entered = await page.evaluate(() => (window as any).__exploration.controller.enter());
    if (!(entered as any).ok) continue;
    await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
      null, { timeout: 60_000 });
    const pose = await page.evaluate(() => (window as any).__exploration.controller.frame().camera.pose);
    const middle = { x: plan.start.x + dx / 2, z: plan.start.z + dz / 2 };
    const targetYaw = Math.atan2(middle.x - pose.x, middle.z - pose.z);
    for (let step = 0; step < 120; step += 1) {
      const error = await page.evaluate(target => {
        const current = (window as any).__exploration.controller.frame().camera.pose.yaw;
        let delta = target - current;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        (window as any).__exploration.controller.setLook(Math.max(-3, Math.min(3, delta * 4)), 0);
        return delta;
      }, targetYaw);
      if (Math.abs(error) < .02) break;
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => (window as any).__exploration.controller.setLook(0, 0));
    await page.waitForTimeout(500);
    console.log(name, "under pose", JSON.stringify(pose));
    await page.screenshot({ path: resolve(output, `${quality}-${name}-possessed-under.png`) });
    await page.evaluate(() => (window as any).__exploration.controller.forceExit("leave"));
    await page.waitForFunction(() => ["idle", "cooldown"].includes((window as any).__exploration.controller.phase()),
      null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    return;
  }
};

/** Runs the frozen simulation forward in the page (20 ticks per second of game time). */
const fastForward = (page: Page, seconds: number) => page.evaluate(total => {
  const live = (window as any).__settlement;
  for (let tick = 0; tick < total * 20; tick += 1) live.realUpdate(.05);
}, seconds);

/** Eight soldiers ordered over the stone deck, shot on the way and after arrival. */
const captureSquad = async (page: Page, quality: string, plan: Plan) => {
  const spawned = await page.evaluate(([sx, sz, ex, ez]) => {
    const sim = (window as any).__settlement.simulation;
    // Start from the anchor with the smaller coordinate along the span's main axis.
    const vertical = Math.abs(ex! - sx!) < Math.abs(ez! - sz!);
    const startFirst = vertical ? sz! < ez! : sx! < ex!;
    const anchors = [{ x: sx!, z: sz! }, { x: ex!, z: ez! }];
    const near = startFirst ? anchors[0]! : anchors[1]!, far = startFirst ? anchors[1]! : anchors[0]!;
    const away = { x: Math.sign(near.x - far.x), z: Math.sign(near.z - far.z) };
    const ids = Array.from({ length: 8 }, (_, index) => sim.spawnDebugSoldier({
      x: near.x + away.x * (5 + index % 2) + (away.x ? 0 : (index % 4) - 1.5),
      z: near.z + away.z * (5 + index % 2) + (away.z ? 0 : (index % 4) - 1.5)
    }, { rank: 1, type: ["shield", "heavy", "archer"][index % 3] })?.id).filter((id: unknown) => id !== undefined);
    const goal = { x: far.x - away.x * 6, z: far.z - away.z * 6 };
    return { accepted: sim.commandMilitary(ids, goal, "move"), count: ids.length };
  }, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);
  console.log("squad", JSON.stringify(spawned));
  const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
  for (const [label, seconds] of [["march", 4], ["deck", 3], ["across", 6]] as const) {
    await fastForward(page, seconds);
    await page.evaluate(([cx = 0, cz = 0]) => (window as any).__settlement.focusGround(cx, cz, 1.8), [x, z]);
    await frames(page, 12);
    await page.screenshot({ path: resolve(output, `${quality}-squad-${label}.png`) });
  }
};

/** Lodge beside the headquarters, a recruited commander set in the field before the bridge mouth. */
const fieldCommander = (page: Page, plan: Plan) => page.evaluate(([sx = 0, sz = 0, ex = 0, ez = 0]) => {
  const live = (window as any).__settlement, sim = live.simulation, hq = sim.headquarters;
  for (const ware of ["beer", "coins", "shield", "sword", "wine", "mead", "sake", "tea", "chicha", "kumis"])
    hq.inventory[ware] = (hq.inventory[ware] ?? 0) + 40;
  let lodge: any = null, reason = "";
  for (let radius = 6; radius < 20 && !lodge; radius += 1) for (let step = 0; step < 16 && !lodge; step += 1) {
    const angle = step / 16 * Math.PI * 2;
    // Odd and even footprints snap to cell centres or cell corners.
    for (const offset of [0, .5]) {
      if (lodge) break;
      const placed = sim.placeBuilding(62, Math.round(hq.x + Math.cos(angle) * radius) + offset,
        Math.round(hq.z + Math.sin(angle) * radius) + offset);
      if (placed.ok && placed.building) lodge = placed.building;
      else reason = placed.reason;
    }
  }
  if (!lodge) return { reason: `No lodge place: ${reason}` };
  Object.assign(lodge, { construction: 1, foundationProgress: 1, required: {} });
  // An L-shaped half-cell road from the headquarters to the lodge, laid straight into the graph.
  const steps: any[] = [];
  let at = { ...hq.access };
  for (const axis of ["x", "z"] as const) while (Math.abs(lodge.access[axis] - at[axis]) > 1e-6) {
    const next = { ...at, [axis]: at[axis] + Math.sign(lodge.access[axis] - at[axis]) * .5 };
    steps.push({ end: next, start: at, tier: "dirt" }); at = next;
  }
  const connected = live.roads.replaceSegments([...live.roads.segments(), ...steps]);
  const recruited = sim.recruitCommander(lodge.uid);
  if (!recruited.ok) return { connected, reason: recruited.reason };
  const near = sx < ex ? { x: sx, z: sz } : { x: ex, z: ez }, far = sx < ex ? { x: ex, z: ez } : { x: sx, z: sz };
  const saved = sim.saveState();
  const soldier = saved.military.soldiers.find((row: any) => row.commanderId);
  const actor = saved.actors.find((row: any) => row.uid === soldier.actor);
  Object.assign(actor, { mounted: true, phase: "militaryField", visible: true, x: near.x - 6, yaw: 0, z: near.z });
  soldier.building = -3;
  saved.military.commander.location = "field";
  const loaded = sim.loadState(saved);
  const goal = { x: far.x + 7, z: far.z };
  return { actor: actor.uid, loaded, ordered: sim.commandMilitary([actor.uid], goal, "move") };
}, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);

/** The commander riding over the stone deck: iso shots on the way, then his own eye on the deck. */
const captureCommander = async (page: Page, quality: string, plan: Plan) => {
  const fielded = await fieldCommander(page, plan);
  console.log("commander", JSON.stringify(fielded));
  if (!("actor" in fielded) || !fielded.ordered) return;
  const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
  const where = () => page.evaluate(uid => {
    const body = (window as any).__settlement.simulation.frames().find((frame: any) => frame.uid === uid);
    return body && { mounted: body.mounted, x: body.x, z: body.z };
  }, fielded.actor);
  for (const [label, seconds] of [["approach", 2], ["deck", 1.2], ["across", 4]] as const) {
    await fastForward(page, seconds);
    console.log(label, JSON.stringify(await where()));
    await page.evaluate(([cx = 0, cz = 0]) => (window as any).__settlement.focusGround(cx, cz, 1.8), [x, z]);
    await frames(page, 12);
    await page.screenshot({ path: resolve(output, `${quality}-commander-${label}.png`) });
  }
  // Back onto the deck, then his own eye: the live game loop runs the simulation while possessed.
  await page.evaluate(([cx = 0, cz = 0, uid = 0]) => {
    const live = (window as any).__settlement;
    live.simulation.commandMilitary([uid], { x: cx, z: cz }, "move");
    live.simulation.update = live.realUpdate;
  }, [x, z, fielded.actor]);
  await page.waitForTimeout(6000);
  console.log("on deck", JSON.stringify(await where()));
  const entered = await page.evaluate(() => (window as any).__commanderControl?.controller.enter());
  console.log("possess", JSON.stringify(entered));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(output, `${quality}-commander-possessed-deck.png`) });
};

/** Rewrites every placed bridge to one level (saved 0–4) through a save reload, as an upgrade would. */
const setBridgeLevels = (page: Page, level: number) => page.evaluate(saved => {
  const sim = (window as any).__settlement.simulation, save = sim.saveState();
  save.roads = save.roads.map((segment: any) => segment.bridge
    ? { ...segment, bridge: { ...segment.bridge, level: saved || undefined } } : segment);
  return sim.loadState(save);
}, level);

/** Screen point of a bridge's deck centre, at the shared deck height. */
const deckScreen = (page: Page, plan: Plan) => page.evaluate(([sx = 0, sz = 0, ex = 0, ez = 0]) => {
  const x = (sx + ex) / 2, z = (sz + ez) / 2;
  const { renderer } = (window as any).__bridgeWorld;
  return (window as any).__settlement.project(x, renderer.bridgeHeight?.(x, z) ?? 0, z);
}, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);

const lookAt = async (page: Page, plan: Plan, zoom: number) => {
  const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
  await page.evaluate(([cx, cz, level]) => (window as any).__settlement.focusGround(cx, cz, level), [x, z, zoom]);
  await frames(page, 14);
};

/** Each bridge at every level, close up and at gameplay distance. */
const captureLevels = async (page: Page, quality: string, plans: Record<string, Plan>, deck = false) => {
  const shots: (readonly [string, number])[] = [["close", 2.2], ["iso", 1], ...(deck ? [["deck", 3.6] as const] : [])];
  for (let level = 0; level < 5; level += 1) {
    if (!v2Levels.includes(level + 1)) continue;
    console.log("level", level + 1, JSON.stringify(await setBridgeLevels(page, level)));
    await frames(page, 6);
    for (const [name, plan] of Object.entries(plans)) for (const [label, zoom] of shots) {
      await lookAt(page, plan, zoom);
      await page.screenshot({ path: resolve(output, `${quality}-level${level + 1}-${name}-${label}.png`) });
    }
  }
};

/** Hover, click (selection outline and panel), the upgrade confirmation, then a removal under a squad. */
const capturePanel = async (page: Page, quality: string, plans: Record<string, Plan>) => {
  const selected = plans["stone-straight"], other = plans["wood-straight"];
  if (!selected || !other) return;
  await setBridgeLevels(page, 2);
  await lookAt(page, selected, 1.3);
  const hover = await deckScreen(page, selected);
  await page.screenshot({ path: resolve(output, `${quality}-before-hover.png`) });
  await page.mouse.move(hover.x, hover.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, `${quality}-hover.png`) });
  await page.mouse.click(hover.x, hover.y);
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, `${quality}-panel.png`) });
  await page.click("[data-bridge-upgrade]", { force: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, `${quality}-panel-upgrade.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await captureSquadRemoval(page, quality, selected);
};

/** A squad on the selected deck when Remove is confirmed: everyone ends on a bank, none in the river. */
const captureSquadRemoval = async (page: Page, quality: string, plan: Plan) => {
  await page.evaluate(([sx = 0, sz = 0, ex = 0, ez = 0]) => {
    const sim = (window as any).__settlement.simulation;
    const vertical = Math.abs(ex - sx) < Math.abs(ez - sz);
    const [near, far] = (vertical ? sz < ez : sx < ex)
      ? [{ x: sx, z: sz }, { x: ex, z: ez }] : [{ x: ex, z: ez }, { x: sx, z: sz }];
    const away = { x: Math.sign(near!.x - far!.x), z: Math.sign(near!.z - far!.z) };
    const ids = Array.from({ length: 8 }, (_, index) => sim.spawnDebugSoldier({
      x: near!.x + away.x * (2 + index % 2) + (away.x ? 0 : (index % 4) - 1.5),
      z: near!.z + away.z * (2 + index % 2) + (away.z ? 0 : (index % 4) - 1.5)
    }, { rank: 1, type: ["shield", "heavy", "archer"][index % 3] })?.id).filter((id: unknown) => id !== undefined);
    sim.commandMilitary(ids, { x: far!.x - away.x * 6, z: far!.z - away.z * 6 }, "move");
  }, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);
  await fastForward(page, 3);
  await lookAt(page, plan, 1.8);
  await page.screenshot({ path: resolve(output, `${quality}-removal-before.png`) });
  await page.click("[data-bridge-remove]");
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, `${quality}-removal-question.png`) });
  await page.click("[data-bridge-remove-yes]");
  await frames(page, 20);
  await page.screenshot({ path: resolve(output, `${quality}-removal-after.png`) });
  await fastForward(page, 6);
  await frames(page, 12);
  await page.screenshot({ path: resolve(output, `${quality}-removal-waiting.png`) });
};

const bridgeIdOf = (page: Page, plan: Plan) => page.evaluate(([sx = 0, sz = 0]) =>
  (window as any).__settlement.simulation.bridges().find((bridge: any) =>
    bridge.start.x === sx && bridge.start.z === sz)?.id, [plan.start.x, plan.start.z]);

const removalOf = (page: Page, id: number) => page.evaluate(bridge =>
  (window as any).__settlement.simulation.bridges().find((entry: any) => entry.id === bridge)?.removal ?? null, id);

/** Remove under a squad on the deck: pending (closing) panel, the walk-off, then the reverse stages. */
const captureDismantling = async (page: Page, quality: string, plan: Plan, tiles: number) => {
  const id = await bridgeIdOf(page, plan);
  if (id === undefined) return;
  await lookAt(page, plan, 1.6);
  const deck = await deckScreen(page, plan);
  await page.mouse.click(deck.x, deck.y);
  await page.waitForTimeout(1200);
  await page.mouse.move(5, 450);
  await page.evaluate(([sx = 0, sz = 0, ex = 0, ez = 0]) => {
    const sim = (window as any).__settlement.simulation;
    const ids = Array.from({ length: 6 }, (_, index) => sim.spawnDebugSoldier({
      x: sx + (sx - ex) * 0.6 + (index % 3 - 1) * 0.5, z: sz + (sz - ez) * 0.6 + Math.floor(index / 3) * 0.5
    }, { rank: 1, type: ["shield", "heavy", "archer"][index % 3] })?.id).filter((uid: unknown) => uid !== undefined);
    sim.commandMilitary(ids, { x: ex + (ex - sx) * 0.8, z: ez + (ez - sz) * 0.8 }, "move");
  }, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);
  for (let step = 0; step < 80; step += 1) {
    await fastForward(page, 0.15);
    const onDeck = await page.evaluate(([sx = 0, sz = 0, ex = 0, ez = 0]) => {
      const length = Math.hypot(ex - sx, ez - sz), ux = (ex - sx) / length, uz = (ez - sz) / length;
      return (window as any).__settlement.simulation.frames().filter((frame: any) => {
        const along = (frame.x - sx) * ux + (frame.z - sz) * uz;
        return frame.job === "Soldier" && along > 0.3 && along < length - 0.3;
      }).length;
    }, [plan.start.x, plan.start.z, plan.end.x, plan.end.z]);
    if (onDeck >= 3) break;
  }
  await lookAt(page, plan, 1.6);
  await page.screenshot({ path: resolve(output, `${quality}-remove-before.png`) });
  await page.click("[data-bridge-remove]");
  await page.waitForTimeout(300);
  await page.click("[data-bridge-remove-yes]");
  await frames(page, 12);
  await page.screenshot({ path: resolve(output, `${quality}-remove-pending.png`) });
  // The reverse stages read best without the selection outline: close the panel.
  await page.getByRole("button", { name: /close.*bridge/i }).first().click({ force: true }).catch(() => undefined);
  await fastForward(page, 0.6);
  await frames(page, 12);
  await page.screenshot({ path: resolve(output, `${quality}-remove-walking-off.png`) });
  for (let step = 0; step < 140 && (await removalOf(page, id))?.phase === "closing"; step += 1)
    await fastForward(page, 0.5);
  const total = 2.5 * tiles;
  for (const [index, share] of [0.1, 0.3, 0.3, 0.2].entries()) {
    await fastForward(page, total * share);
    await frames(page, 10);
    console.log("dismantling", JSON.stringify(await removalOf(page, id)));
    await page.screenshot({ path: resolve(output, `${quality}-dismantle-${index + 1}.png`) });
  }
  await fastForward(page, total * 0.2);
  await frames(page, 10);
  await page.screenshot({ path: resolve(output, `${quality}-dismantle-gone.png`) });
};

/**
 * A loaded carrier standing a few steps from the headquarters with a cut-off bridge wait is put in a
 * save; the load resolves the wait at once (its timer is not saved), so the carrier fades out there and
 * in at the headquarters' door with its planks.
 */
const captureCarrierFade = async (page: Page, quality: string, unreachable: { x: number; z: number }) => {
  const spot = await page.evaluate(([dx = 0, dz = 0]) => {
    const sim = (window as any).__settlement.simulation, save = sim.saveState(), hq = sim.headquarters;
    const point = { x: hq.access.x + 3, z: hq.access.z + 1.5 };
    save.actors.push({ action: "idle", animationTime: 0, bridgeWait: { destination: { x: dx, z: dz } },
      building: hq.uid, home: hq.uid, job: "Carrier", path: [point], pathIndex: 0, phase: "home", timer: 0,
      uid: save.nextActor, visible: true, ware: "planks", x: point.x, y: hq.y, yaw: 0, z: point.z });
    save.nextActor += 1;
    // Show the carrier waiting first (a plain frame), then load the save that resolves its wait.
    (window as any).__fadeSave = save;
    return { point, uid: save.nextActor - 1 };
  }, [unreachable.x, unreachable.z]);
  await page.evaluate(([cx = 0, cz = 0]) => (window as any).__settlement.focusGround(cx, cz, 2.4),
    [spot.point.x - 1.5, spot.point.z - 0.75]);
  await frames(page, 12);
  const resolved = await page.evaluate(() =>
    (window as any).__settlement.simulation.loadState((window as any).__fadeSave));
  console.log("fade load", JSON.stringify(resolved));
  for (const [index, wait] of [60, 300, 300, 300].entries()) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: resolve(output, `${quality}-carrier-fade-${index + 1}.png`) });
  }
};

/** `V2_PARTS` (comma list of levels, removal, fade) narrows a rerun; all three by default. */
const v2Parts = (process.env.V2_PARTS ?? "levels,removal,fade").split(",");
/** `V2_LEVELS` (comma list of panel levels 1–5) narrows the tier shots; all five by default. */
const v2Levels = (process.env.V2_LEVELS ?? "1,2,3,4,5").split(",").map(Number);

const captureV2 = async (page: Page, quality: string, plans: Record<string, Plan & { tiles: number }>) => {
  const woods = Object.fromEntries(Object.entries(plans).filter(([name]) => name.startsWith("wood")));
  if (v2Parts.includes("levels")) await captureLevels(page, quality, woods, true);
  const wood = plans["wood-straight"];
  if (!wood) return;
  await setBridgeLevels(page, 3);
  await frames(page, 6);
  if (v2Parts.includes("removal")) await captureDismantling(page, quality, wood, wood.tiles);
  if (v2Parts.includes("fade")) await captureCarrierFade(page, quality, wood.end);
};

/** Both mouths of every wooden bridge close up at levels 1, 3 and 5: the timber lies over the road end. */
const captureEnds = async (page: Page, quality: string, plans: Record<string, Plan>) => {
  for (const level of [0, 2, 4]) {
    await setBridgeLevels(page, level);
    await frames(page, 6);
    for (const [name, plan] of Object.entries(plans)) {
      if (!name.startsWith("wood")) continue;
      for (const [label, end] of [["start", plan.start], ["end", plan.end]] as const) {
        await page.evaluate(([cx = 0, cz = 0]) => (window as any).__settlement.focusGround(cx, cz, 4.2), [end.x, end.z]);
        await frames(page, 14);
        await page.screenshot({ path: resolve(output, `${quality}-level${level + 1}-${name}-${label}.png`) });
      }
    }
  }
};

/**
 * Low, nearly level side views across each wooden landing's edge (levels 1, 3, 5): any slit between
 * the timber and the road shows against the sky or the far bank.
 */
const captureRampGaps = async (page: Page, quality: string, plans: Record<string, Plan>) => {
  for (const level of [0, 2, 4]) {
    await setBridgeLevels(page, level);
    await frames(page, 6);
    for (const [name, plan] of Object.entries(plans)) {
      if (!name.startsWith("wood")) continue;
      const span = Math.atan2(plan.end.x - plan.start.x, plan.end.z - plan.start.z);
      for (const [label, end] of [["start", plan.start], ["end", plan.end]] as const)
        for (const [side, yaw] of [span + Math.PI / 2, span - Math.PI / 2].entries()) {
          await page.evaluate(([cx = 0, cz = 0, turn = 0]) => {
            const { camera } = (window as any).__bridgeWorld;
            (window as any).__settlement.focusGround(cx, cz, 5);
            camera.yaw = turn;
            camera.tilt = -0.85;
          }, [end.x, end.z, yaw]);
          await frames(page, 14);
          await page.screenshot({ path: resolve(output, `${quality}-level${level + 1}-${name}-${label}-side${side}.png`) });
        }
    }
  }
  await page.evaluate(() => { const { camera } = (window as any).__bridgeWorld; camera.yaw = 0; camera.tilt = 0; });
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", error => console.log("pageerror", error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=v=>v;");
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), script = await response.text();
      const marker = "profileFirstFrame(renderer, () => {";
      if (!script.includes(marker)) throw new Error("island-runtime marker missing");
      await route.fulfill({ response, body: script.replace(marker,
        `window.__bridgeWorld={world,camera,renderer};${marker}`) });
    });
    // The commander run needs the Commander's Lodge, unlocked only at level 23.
    const unlock = commanderRun ? "&unlockall=1" : "";
    await page.goto(`${url}admin.html?quality=${quality}&seed=${seed}&size=96&rivers=2&forest=0&cache=0&time=day${unlock}`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const placed = await placeBridges(page);
    console.log(quality, JSON.stringify(placed));
    await frames(page, 10);
    if (rampGap) {
      await captureRampGaps(page, quality, placed.plans);
      await page.close();
      continue;
    }
    if (ends) {
      await captureEnds(page, quality, placed.plans);
      await page.close();
      continue;
    }
    if (v2) {
      await captureV2(page, quality, placed.plans);
      await page.close();
      continue;
    }
    if (panel) {
      await captureLevels(page, quality, placed.plans);
      await capturePanel(page, quality, placed.plans);
      await page.close();
      continue;
    }
    if (commanderRun) {
      if (placed.plans["stone-angled"]) await captureCommander(page, quality, placed.plans["stone-angled"]);
      await page.close();
      continue;
    }
    if (life) {
      if (placed.plans["stone-straight"]) {
        await captureSquad(page, quality, placed.plans["stone-straight"]);
      }
      await page.close();
      continue;
    }
    if (grounded) {
      for (const [name, plan] of Object.entries(placed.plans) as [string, any][]) {
        if (!name.startsWith("stone")) continue;
        await captureGrounded(page, quality, name, plan);
        if (name === "stone-straight") await capturePossessedUnder(page, quality, name, plan);
      }
      await page.close();
      continue;
    }
    if (overlay) {
      if (placed.plans["stone-straight"]) await captureOverlay(page, quality, placed.plans["stone-straight"]);
      await page.close();
      continue;
    }
    for (const [name, plan] of Object.entries(placed.plans) as [string, any][]) {
      if (possess) {
        if (!process.env.ONLY || process.env.ONLY === name) await capturePossessed(page, quality, name, plan);
        continue;
      }
      const x = (plan.start.x + plan.end.x) / 2, z = (plan.start.z + plan.end.z) / 2;
      const shots = [["iso", .9, 0], ["close", 2, 0]] as const;
      for (const [label, zoom] of shots) {
        await page.evaluate(([cx, cz, level]) => (window as any).__settlement.focusGround(cx, cz, level),
          [x, z, zoom]);
        await frames(page, 12);
        await page.screenshot({ path: resolve(output, `${quality}-${name}-${label}.png`) });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
