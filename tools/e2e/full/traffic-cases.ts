import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { clickGround, hideBuildPanel } from "./natural-ui-helpers";
import { createProgressTracker } from "./observations";
import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
interface TrafficOptions { observeSeconds?: number }
type Edge = { start: { x: number; z: number }; end: { x: number; z: number } };

const chooseBusyRoad = (page: Page) => page.evaluate(() => {
  const sim = (window as any).__settlement.simulation;
  const actors = sim.frames().filter((actor: any) => actor.visible && actor.delivery && actor.ware);
  if (!actors.length) return null;
  const stone = sim.buildings().filter((b: any) => [0, 29, 39].includes(b.typeId))
    .reduce((sum: number, b: any) => sum + (b.inventory.stone ?? 0), 0);
  const reserved = sim.buildings().reduce((sum: number, b: any) => sum + Math.max(0,
    (b.required.stone ?? 0) - (b.input.stone ?? 0) - (b.incoming.stone ?? 0) -
    (b.constructionConsumed?.stone ?? 0)), 0);
  if (stone - reserved < 1) return null;
  const live = (window as any).__settlement;
  const candidates = sim.roadSegments().filter((road: any) => {
    if (road.preview || road.doorway || road.tier !== "dirt") return false;
    const centre = { x: (road.start.x + road.end.x) / 2, z: (road.start.z + road.end.z) / 2 };
    // Keep removal away from authored entrance strips and overlapping click targets.
    if (sim.buildings().some((b: any) => Math.abs(centre.x - b.x) < b.width / 2 + 2 &&
      Math.abs(centre.z - b.z) < b.depth / 2 + 2)) return false;
    return [road.start, road.end].every(point => {
      const screen = live.projectGround(point.x, point.z);
      return screen.x > 130 && screen.x < innerWidth - 130 && screen.y > 150 && screen.y < innerHeight - 130;
    });
  }).map((road: any) => {
    const point = (a: any, b: any) => a.x === b.x && a.z === b.z;
    const affected = actors.filter((actor: any) => actor.path.slice(Math.max(0, actor.pathIndex - 1))
      .some((end: any, index: number, path: any[]) => index > 0 &&
        ((point(path[index - 1], road.start) && point(end, road.end)) ||
          (point(path[index - 1], road.end) && point(end, road.start)))));
    return { ...road, affected: affected.map((actor: any) => ({ uid: actor.uid, delivery: { ...actor.delivery } })),
      distance: Math.min(...affected.map((actor: any) =>
        Math.hypot(actor.x - (road.start.x + road.end.x) / 2, actor.z - (road.start.z + road.end.z) / 2))) };
  }).filter((road: any) => road.affected.length && road.distance < 3 && sim.planRoad(road.start, road.end, "stone"))
    .sort((a: any, b: any) => a.distance - b.distance);
  return candidates[0] ?? null;
});

const roadState = (page: Page, edge: Edge) => page.evaluate(({ end, start }) => {
  const sim = (window as any).__settlement.simulation;
  const point = (a: any, b: any) => a.x === b.x && a.z === b.z;
  const found = sim.roadSegments().find((road: any) => !road.preview && !road.doorway &&
    ((point(road.start, start) && point(road.end, end)) || (point(road.start, end) && point(road.end, start))));
  return { revision: sim.roadRevision(), tier: found?.tier ?? null };
}, edge);

const roadMode = async (page: Page, name: "Stone road" | "Remove road" | "Dirt road") => {
  await page.keyboard.press("Escape");
  if (!await page.getByRole("heading", { name: "Build your settlement", exact: true }).isVisible())
    await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Roads", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await hideBuildPanel(page);
};

const trafficSnapshot = (page: Page) => page.evaluate(async () => {
  const sim = (window as any).__settlement.simulation;
  const url = "/tools/e2e/full/observations.ts";
  const { observeGoodsLedger, sampleActors } = await import(/* @vite-ignore */ url);
  const rulesUrl = "/src/shared/settlement/production-rules.ts";
  const { getProductionRule } = await import(/* @vite-ignore */ rulesUrl);
  const buildings = sim.buildings(), actors = sim.frames(), context: Record<number, any> = {};
  for (const actor of actors) {
    const building = buildings.find((b: any) => b.uid === actor.building);
    const rule = building && getProductionRule(building.typeId, sim.playerNation());
    const entry: any = { cycleSeconds: actor.productionSeconds ?? rule?.seconds ?? 0,
      progress: building ? building.cycle + building.construction : undefined };
    if (building?.productionPaused) entry.wait = "paused";
    else if (building?.status === "Output stock full") entry.wait = "full-output";
    else if (building?.status === "Waiting for inputs") entry.wait = "missing-input";
    else if (rule?.tool && building?.status === `Waiting for ${rule.tool}`) entry.wait = "missing-tool";
    else if (["Waiting for reachable resource", "Deposit exhausted", "Waiting for a clear sowing plot"]
      .includes(building?.status)) entry.wait = "no-target";
    context[actor.uid] = entry;
  }
  const active = actors.filter((actor: any) => actor.visible || actor.ware || actor.delivery || actor.queueKind);
  return { at: performance.now() / 1000, samples: sampleActors(active, performance.now() / 1000, context),
    goods: observeGoodsLedger(buildings, actors), roadRevision: sim.roadRevision(),
    pending: active.filter((a: any) => a.delivery).map((a: any) => ({ uid: a.uid, phase: a.phase,
      delivery: { ...a.delivery }, ware: a.ware, queue: a.queueKind, wait: a.queueWait,
      target: a.path.at(-1) ?? null, x: a.x, z: a.z })) };
});

const observeTraffic = async (page: Page, seconds: number) => {
  const tracker = createProgressTracker(), samples: unknown[] = [], warnings: unknown[] = [];
  const first = await trafficSnapshot(page), deadline = Date.now() + seconds * 1000;
  let last = first;
  const movedActors = new Set<number>();
  const initial = new Map(first.samples.map((actor: any) => [actor.uid, actor]));
  while (Date.now() < deadline) {
    last = await trafficSnapshot(page);
    assert.deepEqual(last.goods.invalid, [], "Negative or nonfinite physical ware ownership observed");
    for (const actor of last.samples) {
      assert(Number.isFinite(actor.x) && Number.isFinite(actor.z), `Invalid actor position ${actor.uid}`);
      const before = initial.get(actor.uid) as any;
      if (before && (Math.hypot(before.x - actor.x, before.z - actor.z) > .2 ||
        before.phase !== actor.phase || before.ware !== actor.ware)) movedActors.add(actor.uid);
    }
    const progress = tracker(last.samples);
    if (warnings.length < 32 && progress.suspected.length) warnings.push({ at: last.at, actors: progress.suspected });
    if (samples.length < 120) samples.push({ at: last.at, pending: last.pending,
      roadRevision: last.roadRevision, waits: progress.observations.filter(row => row.classification.startsWith("waiting:")) });
    await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - Date.now())));
  }
  return { first, last, samples, movedActors: [...movedActors], warnings,
    scope: "Wall-clock movement/work/queue sampling; waits derive visible building statuses and remain diagnostic. " +
      "Warnings require actual simulation-speed and queue review; no permanent-deadlock verdict or full conservation claim." };
};

/** One ordinary UI route change, followed by bounded scheduler-driven ownership/progress evidence. */
export const runTrafficCases = async (page: Page, runCase: RunCase, options: TrafficOptions = {}) => {
  const seconds = options.observeSeconds ?? Number(process.env.E2E_OBSERVE_SECONDS ?? 60);
  assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 3600, "Traffic observation seconds must be within (0, 3600]");
  let edge: Edge | undefined;
  let affected: Array<{ uid: number; delivery: { source: number; destination: number; ware: string } }> = [];
  await runCase("E2E-07-live-road-upgrade", "Finite stone UI upgrade beside actual loaded traffic", async () => {
    const selected = await chooseBusyRoad(page);
    if (!selected) throw new MissingPrerequisite("Needs loaded carriers, finite stone and a visible dirt edge away from entrances");
    const chosen: Edge = selected;
    const before = await roadState(page, chosen);
    await roadMode(page, "Stone road"); await clickGround(page, chosen.start); await clickGround(page, chosen.end);
    await page.keyboard.press("Escape");
    const after = await roadState(page, chosen);
    assert.equal(after.tier, "stone", "UI upgrade did not change the selected public edge to stone");
    assert(after.revision > before.revision, "Stone upgrade did not advance the road revision");
    edge = chosen;
    affected = selected.affected;
    return { edge, before, after, expectedCost: "One finite stone per upgraded half-cell edge; inventory contention prevents isolated net-cost proof" };
  });
  await runCase("E2E-07-remove-reconnect", "Remove and reconnect the actual upgraded public road using UI", async () => {
    if (!edge) throw new MissingPrerequisite("Busy road prerequisite missing");
    const before = await trafficSnapshot(page);
    const stillAssigned = affected.filter(actor => before.pending.some((current: any) => current.uid === actor.uid &&
      current.delivery.source === actor.delivery.source && current.delivery.destination === actor.delivery.destination &&
      current.ware === actor.delivery.ware));
    if (!stillAssigned.length) throw new MissingPrerequisite("Originally affected cargo jobs completed before disruption; fresh loaded-route fixture required");
    await roadMode(page, "Remove road");
    await clickGround(page, { x: (edge.start.x + edge.end.x) / 2, z: (edge.start.z + edge.end.z) / 2 });
    await page.keyboard.press("Escape");
    assert.equal((await roadState(page, edge)).tier, null, "Selected public edge was not removed");
    await page.waitForTimeout(1000);
    const disrupted = await trafficSnapshot(page);
    await roadMode(page, "Dirt road"); await clickGround(page, edge.start); await clickGround(page, edge.end);
    await page.keyboard.press("Escape");
    assert.equal((await roadState(page, edge)).tier, "dirt", "UI reconnection did not restore the selected edge");
    const observation = await observeTraffic(page, seconds);
    if (!stillAssigned.some(actor => observation.first.pending.some((row: any) => row.uid === actor.uid)))
      throw new MissingPrerequisite("Affected cargo jobs finished before the recovery baseline; the transition was not observed");
    const affectedProgress = stillAssigned.filter(actor => observation.movedActors.includes(actor.uid));
    assert(affectedProgress.length > 0,
      "No observed movement/work/cargo transition from the originally affected carrier cohort after reconnect");
    return { before, disrupted, observation, affectedProgress,
      scope: "Public edge upgrade/removal/reconnect and sampled recovery. Door contention, carts, junction families and long soak remain separate coverage." };
  });
};
