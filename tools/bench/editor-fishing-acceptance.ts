import assert from "node:assert/strict";

import { type EditorSession, selectPaletteDecoration } from "./editor-native-session";
import { resumeSavedGame, saveFromMenu } from "./save-helpers";

export interface EditorFishingFixture {
  aquatic: { kind: string; x: number; z: number }[];
  plot: { rotation: number; x: number; z: number };
  shore: { x: number; z: number };
}

/** Real natural shore/owned plot/road preflight; aquarium scenery is authored through visible controls. */
export const prepareEditorFishing = async (session: EditorSession): Promise<EditorFishingFixture | null> => {
  const { page } = session;
  const fixture = await page.evaluate(async () => {
    const [{ fishingSites }, { makeBuilding }, { checkPropSpot }, { BLOCKING, PROP }] = await Promise.all([
      import(/* @vite-ignore */ String("/src/shared/settlement/settlement-fishing.ts")),
      import(/* @vite-ignore */ String("/src/shared/settlement/settlement-placement.ts")),
      import(/* @vite-ignore */ String("/src/shared/world/editing/prop-placement.ts")),
      import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"))
    ]);
    const { world } = (window as any).__editorReview, sim = (window as any).__settlement.simulation;
    const hq = sim.headquarters;
    if (!hq) return null;
    const context = { options: { world }, occupied: new Uint8Array(world.cellsX * world.cellsZ),
      buildings: sim.buildings(), actors: sim.frames(), nextBuilding: sim.saveState().nextBuilding };
    const shores: any[] = [];
    for (let z = Math.max(2, Math.floor(hq.z) - 45); z < Math.min(world.cellsZ - 2, hq.z + 45); z++)
      for (let x = Math.max(2, Math.floor(hq.x) - 45); x < Math.min(world.cellsX - 2, hq.x + 45); x++) {
        const cell = z * world.cellsX + x;
        if (!world.walkCost[cell] || ![cell - 1, cell + 1, cell - world.cellsX, cell + world.cellsX]
          .some(next => world.blocking[next] === BLOCKING.water)) continue;
        shores.push(...fishingSites(context, { id: cell, kind: "fish", x: x + .5, z: z + .5 }));
      }
    for (let radius = 3; radius < 40; radius++)
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = Math.floor(hq.x) + dx, z = Math.floor(hq.z) + dz;
        if (sim.validatePlacement(18, x, z, 0)) continue;
        const draft = makeBuilding(context, 18, x, z, 0);
        if (!sim.planRoad(hq.access, draft.access, "dirt")) continue;
        const nearby = shores.filter(shore => Math.hypot(shore.x - x, shore.z - z) < 20)
          .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        for (const shore of nearby.slice(0, 8)) {
          const aquatic: { kind: string; x: number; z: number }[] = [];
          for (const [kind, prop] of [["Water lily", PROP.waterLily], ["Reeds", PROP.reeds], ["Cattail", PROP.cattail]] as const) {
            for (let ring = 0; ring < 9 && !aquatic.some(point => point.kind === kind); ring++)
              for (let turn = 0; turn < 8; turn++) {
                const point = { kind, x: shore.x + Math.cos(turn * Math.PI / 4) * ring * .5,
                  z: shore.z + Math.sin(turn * Math.PI / 4) * ring * .5 };
                if (aquatic.some(used => Math.hypot(used.x - point.x, used.z - point.z) < 1)) continue;
                if (nearby.slice(0, 12).some(site => site.approach &&
                  Math.hypot(site.approach.x - point.x, site.approach.z - point.z) < .8)) continue;
                if (!checkPropSpot(world, prop, point.x, point.z)) { aquatic.push(point); break; }
              }
          }
          if (aquatic.length >= 2) return { aquatic, plot: { rotation: 0, x, z },
            shore: { x: shore.x, z: shore.z } };
        }
      }
    return null;
  });
  if (!fixture) {
    session.rows.push({ name: "native-fishing-preflight", outcome: "unknown",
      detail: "No owned legal natural fishery, road preview and adjacent aquatic habitat found" });
    session.flush(); return null;
  }
  await page.getByRole("tab", { name: "Plants and decorations", exact: true }).click();
  for (const point of fixture.aquatic) await session.step(`fishing-habitat-${point.kind.toLowerCase().replaceAll(" ", "-")}`, async () => {
    await selectPaletteDecoration(page, point.kind);
    await session.click(point);
  });
  session.rows.push({ name: "native-fishing-owned-shore-and-aquatic-fixture", fixture });
  session.flush(); return fixture;
};

/** Finished construction is fixture setup; tools, worker assignment, walking and fishing remain native. */
export const exerciseEditorFishing = async (session: EditorSession, fixture: EditorFishingFixture) => {
  const { page } = session;
  const waiting = await page.evaluate(async fixture => {
    const sim = (window as any).__settlement.simulation, hq = sim.headquarters;
    const refused = sim.validatePlacement(18, fixture.plot.x, fixture.plot.z, fixture.plot.rotation);
    if (refused) throw new Error(`Played fishery plot refused: ${refused}`);
    const { getConstructionCost } = await import(/* @vite-ignore */ String(
      "/src/shared/settlement/construction-costs.ts"));
    const cost = getConstructionCost(18), setupGrant: Record<string, number> = {};
    for (const [ware, amount] of Object.entries(cost)) {
      const grant = Math.max(0, (amount as number) - (hq.inventory[ware] ?? 0));
      if (grant) { hq.inventory[ware] = (hq.inventory[ware] ?? 0) + grant; setupGrant[ware] = grant; }
    }
    const placed = sim.placeBuilding(18, fixture.plot.x, fixture.plot.z, fixture.plot.rotation);
    if (!placed.ok) throw new Error(placed.reason);
    const building = placed.building;
    if (!sim.connectRoads(hq.access, building.access)) throw new Error("Native fishery road connection refused");
    const rodGrant = (hq.inventory.fishingRod ?? 0) < 1;
    if (rodGrant) hq.inventory.fishingRod = 1;
    Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
    for (const [ware, amount] of Object.entries(cost)) if ((amount as number) > 0)
      hq.inventory[ware] -= amount as number;
    const phases = new Set<string>();
    for (let tick = 0; tick < 24000; tick++) {
      sim.update(.05);
      const actor = sim.frames().find((entry: any) => entry.uid === building.worker);
      if (!actor) continue;
      phases.add(actor.phase);
      if (actor.phase !== "fishWait") continue;
      const target = structuredClone(actor.target);
      const key = `fish:${target.id}`;
      const remaining = new Map(sim.saveState().resourceAmounts).get(key) ?? 12;
      (window as any).__settlement.focusGround((actor.x + target.x) / 2, (actor.z + target.z) / 2, 3);
      return { actor: { x: actor.x, y: actor.y, z: actor.z }, cost, key, phases: [...phases], remaining,
        rodGrant, setupGrant, target, uid: building.uid, worker: building.worker };
    }
    throw new Error("Normally staffed Fisher did not walk to the natural shore and cast");
  }, fixture);
  assert(waiting.phases.includes("outbound")); assert(waiting.phases.includes("fishCast"));
  assert.equal(waiting.remaining, 12);
  assert(fixture.aquatic.some(point => Math.hypot(point.x - waiting.target.x, point.z - waiting.target.z) < 6),
    "The actual cast must be beside the authored aquatic habitat");
  await page.waitForFunction(target => (window as any).__settlement.workerFrames.some((frame: any) =>
    frame.fishingTarget && Math.hypot(frame.fishingTarget.x - target.x, frame.fishingTarget.z - target.z) < .01),
  waiting.target, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${session.output}/native-fisher-aquatic-cast.png` });
  const caught = await page.evaluate(waiting => {
    const sim = (window as any).__settlement.simulation, phases = new Set<string>();
    for (let tick = 0; tick < 6000; tick++) {
      sim.update(.05);
      const actor = sim.frames().find((entry: any) => entry.uid === waiting.worker);
      if (actor) phases.add(actor.phase);
      const building = sim.buildings().find((entry: any) => entry.uid === waiting.uid);
      if ((building.output.fish ?? 0) >= 1) return { output: building.output.fish, phases: [...phases],
        remaining: new Map(sim.saveState().resourceAmounts).get(waiting.key) };
    }
    throw new Error("The native Fisher did not land and put down a catch");
  }, waiting);
  assert(caught.phases.includes("fishReel")); assert(caught.phases.includes("outputWalk"));
  assert.equal(caught.output, 1); assert.equal(caught.remaining, 11);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${session.output}/native-fisher-first-finite-catch.png` });
  await saveFromMenu(page); await resumeSavedGame(page);
  const restored = await page.evaluate(({ key, uid }) => {
    const sim = (window as any).__settlement.simulation;
    return { remaining: new Map(sim.saveState().resourceAmounts).get(key),
      worker: sim.buildings().find((entry: any) => entry.uid === uid)?.worker };
  }, waiting);
  assert.equal(restored.remaining, 11); assert.equal(restored.worker, waiting.worker);
  session.rows.push({ name: "native-fisher-staff-path-cast-finite-catch", caught, fixture, restored, waiting,
    limit: "Finished fishery, missing canonical construction supplies and at most one rod are explicit setup; recipe is debited, worker and fishing phases are native" });
  session.flush();
};
