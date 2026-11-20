import assert from "node:assert/strict";

import type { EditorSession } from "./editor-native-session";

/** An external one-stone supply visitor exercises the actual reserved harbour's sea approach and exit. */
export const exerciseEditorHarbour = async (session: EditorSession) => {
  const { page } = session;
  const berthed = await page.evaluate(async () => {
    const { world } = (window as any).__editorReview, sim = (window as any).__settlement.simulation;
    const plot = world.scenario?.harbourPlot, hq = sim.headquarters;
    if (!plot) return null;
    const reason = sim.validatePlacement(39, plot.x, plot.z, plot.rotation);
    if (reason) throw new Error(`The actual reserved harbour cannot be placed: ${reason}`);
    const { getConstructionCost } = await import(/* @vite-ignore */ String(
      "/src/shared/settlement/construction-costs.ts"));
    const cost = getConstructionCost(39), setupGrant: Record<string, number> = {};
    for (const [ware, amount] of Object.entries(cost)) {
      const grant = Math.max(0, (amount as number) - (hq.inventory[ware] ?? 0));
      if (grant) { hq.inventory[ware] = (hq.inventory[ware] ?? 0) + grant; setupGrant[ware] = grant; }
    }
    const result = sim.placeBuilding(39, plot.x, plot.z, plot.rotation);
    if (!result.ok) throw new Error(result.reason);
    const harbour = result.building;
    if ((hq.idleSettlers ?? 0) < 4) throw new Error("Not enough finite existing HQ crew for harbour fixture");
    hq.idleSettlers -= 4;
    Object.assign(harbour, { construction: 1, foundationProgress: 1, idleSettlers: 4, required: {} });
    for (const [ware, amount] of Object.entries(cost)) if ((amount as number) > 0)
      hq.inventory[ware] -= amount as number;
    const road = sim.connectRoads(hq.access, harbour.access);
    const stoneBefore = sim.buildings().reduce((sum: number, building: any) => sum +
      (building.inventory.stone ?? 0) + (building.input.stone ?? 0) + (building.output.stone ?? 0), 0) +
      sim.frames().reduce((sum: number, actor: any) => sum + (actor.ware === "stone" ? actor.wareUnits ?? 1 : 0), 0);
    const id = sim.sendVisitorShip({ stone: 1 });
    if (id === null) throw new Error("No real ocean approach admits the supply visitor");
    const phases = new Set<string>(), points: { x: number; z: number }[] = [];
    let lastYaw: number | undefined, turn = 0;
    for (let tick = 0; tick < 60000; tick++) {
      sim.update(.05);
      const ship = sim.shipFrames().find((entry: any) => entry.id === id);
      if (!ship) throw new Error("The visitor vanished before unloading");
      phases.add(ship.phase);
      if (ship.phase === "stranded") throw new Error("The visitor stranded on the reserved harbour approach");
      if (lastYaw !== undefined) turn += Math.abs(Math.atan2(Math.sin(ship.yaw - lastYaw), Math.cos(ship.yaw - lastYaw)));
      lastYaw = ship.yaw;
      if (tick % 50 === 0) points.push({ x: ship.x, z: ship.z });
      if (ship.phase !== "unloading") continue;
      (window as any).__settlement.focusGround(ship.x, ship.z, 1.6);
      const saved = sim.saveState(), restored = sim.loadState(saved);
      if (!restored.ok) throw new Error(restored.reason);
      return { berth: { x: ship.x, z: ship.z }, crew: 4, harbour: harbour.uid, id, phases: [...phases],
        cost, plot, points, road, setupGrant, stoneBefore, tick, turn };
    }
    throw new Error("The reserved harbour never received its real ocean visitor");
  });
  if (!berthed) {
    session.rows.push({ name: "native-authored-harbour-approach", outcome: "unknown",
      detail: "The authored map has no legal reserved harbour plot" });
    session.flush(); return;
  }
  assert(berthed.phases.includes("sailing")); assert(berthed.points.length > 2);
  assert(berthed.turn > .05, "The actual approach must include helm turning");
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${session.output}/native-authored-harbour-visitor-berth.png` });
  const departed = await page.evaluate(({ berth, harbour, id }) => {
    const sim = (window as any).__settlement.simulation, phases = new Set<string>();
    let distance = 0;
    for (let tick = 0; tick < 60000; tick++) {
      sim.update(.05);
      const ship = sim.shipFrames().find((entry: any) => entry.id === id);
      if (!ship) {
        const building = sim.buildings().find((entry: any) => entry.uid === harbour);
        const stone = sim.buildings().reduce((sum: number, building: any) => sum +
          (building.inventory.stone ?? 0) + (building.input.stone ?? 0) + (building.output.stone ?? 0), 0) +
          sim.frames().reduce((sum: number, actor: any) => sum + (actor.ware === "stone" ? actor.wareUnits ?? 1 : 0), 0);
        return { distance, harbourStone: building.inventory.stone ?? 0, phases: [...phases], stone,
          rowers: building.idleSettlers ?? 0, tick };
      }
      phases.add(ship.phase);
      if (ship.phase === "stranded") throw new Error("The visitor stranded after working the reserved harbour");
      distance = Math.max(distance, Math.hypot(ship.x - berth.x, ship.z - berth.z));
    }
    throw new Error("The supply visitor failed to complete unloading and ocean departure");
  }, berthed);
  assert.equal(departed.stone, berthed.stoneBefore + 1); assert.equal(departed.rowers, 4);
  assert(departed.distance > 3, "Departure must sail clear of the berth before leaving the map");
  session.rows.push({ name: "native-authored-harbour-ocean-approach-turn-unload-departure", berthed, departed,
    limit: "Finished harbour, missing canonical construction supplies and moving four existing idle HQ people are explicit fixture setup; the recipe is debited and visitor cargo is external" });
  session.flush();
};
