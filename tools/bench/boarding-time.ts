import { edgeBaySettlement } from "../../tests/helpers/edge-bay-settlement";

/**
 * Loading times of the development menu's test colony and adventure expeditions on the edge-bay
 * test settlement: per ship its passengers, boxes and seconds in "loading" (people walking aboard,
 * then the porters). Usage: npx tsx tools/bench/boarding-time.ts
 */

for (const kind of ["colony", "adventure"] as const) {
  const simulation = edgeBaySettlement();
  const started = simulation.startDebugExpedition(kind);
  if (!started.ok) throw new Error(JSON.stringify(started));
  const loadingSince = new Map<number, number>();
  const rows: string[] = [];
  let time = 0;
  for (let step = 0; step < 30000; step++) {
    simulation.update(.05); time += .05;
    const frames = simulation.shipFrames();
    for (const ship of simulation.ships()) {
      if (ship.visitor) continue;
      if (ship.phase === "loading" && !loadingSince.has(ship.id)) loadingSince.set(ship.id, time);
      const since = loadingSince.get(ship.id);
      if (ship.phase === "loading" || since === undefined || since < 0) continue;
      const boxes = frames.find(frame => frame.id === ship.id)?.deckBoxes;
      rows.push(`${kind} ship ${ship.id}: ${ship.passengers} passengers, ${boxes} boxes, ` +
        `loading ${(time - since).toFixed(1)} s (start ${since.toFixed(0)} s)`);
      loadingSince.set(ship.id, -1);
    }
    const expedition = simulation.colonyExpeditions()[0];
    if (expedition && expedition.status !== "preparing" && expedition.departed >= expedition.loads) break;
  }

  console.log(rows.join("\n"), `\n${kind}: all departed at ${time.toFixed(0)} s`);
}
