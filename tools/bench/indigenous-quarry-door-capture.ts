import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

interface QuarryPlot { rotation: number; type: number; uid: number; x: number; z: number }

/** Wait on real assigned/working routes; never manufacture an actor pose or door state. */
export const captureIndigenousQuarryDoors = async (page: Page, plots: QuarryPlot[],
  quality: string, output: string) => {
  const phases: unknown[] = [];
  for (const plot of plots) for (const target of ["entry", "exit"]) {
    const sample = await page.evaluate(({ target, uid }) => {
      const simulation = (window as any).__pilotReview.simulation;
      const advance = (window as any).__quarryDoorAdvance ??= simulation.update.bind(simulation);
      simulation.update = () => {};
      const building = simulation.buildings().find((entry: any) => entry.uid === uid);
      const phases = target === "entry" ? ["enterAssigned", "enterRest"] : ["outbound"];
      for (let tick = 0; tick < 24000; tick++) {
        const actor = simulation.frames().find((entry: any) => entry.building === uid &&
          phases.includes(entry.phase) && entry.visible &&
          Math.hypot(entry.x - building.doorThreshold.x, entry.z - building.doorThreshold.z) < .30);
        if (actor) return { actorId: actor.uid, door: building.door, phase: actor.phase,
          position: [actor.x, actor.y, actor.z], workTarget: actor.target };
        advance(.025);
      }
      throw new Error(`Quarry ${uid}/rotation ${building.rotation} never traversed ${target}`);
    }, { target, uid: plot.uid });
    const rendered = await page.evaluate(actorId => {
      const settlement = (window as any).__pilotReview.settlement;
      settlement.update(.1); settlement.update(.1);
      const worker = settlement.workerFrames.find((entry: any) => entry.actorId === actorId);
      return worker && { action: worker.action, x: worker.x, z: worker.z };
    }, sample.actorId);
    assert(rendered, `${plot.uid}: actual quarry worker is rendered at ${target}`);
    assert(Math.hypot(rendered.x - sample.position[0], rendered.z - sample.position[2]) < .15);
    assert(sample.door > 0, `${plot.uid}: actual timber door opens for ${target}`);
    await page.evaluate(({ rotation, x, z }) => Object.assign((window as any).__pilotReview.camera,
      { centerX: x, centerZ: z, tilt: 0, yaw: rotation * Math.PI / 2, zoom: 3 }), plot);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: resolve(output, `indigenous-${quality}-19-${plot.rotation}-${target}.png`) });
    phases.push({ quality, rotation: plot.rotation, target, ...sample, rendered });
  }
  return phases;
};
