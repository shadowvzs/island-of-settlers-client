import { readFileSync, writeFileSync } from "node:fs";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { DMath } from "../../src/shared/math/deterministic-math";
import { militaryGroundPath } from "../../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isMountedNavigationClear } from "../../src/shared/settlement/settlement-navigation";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../../src/shared/world/grid-geometry";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

const path = process.argv.slice(2).find(value => !value.startsWith("--")) ??
  "../resources/project-reviews/commander-possession-2026-11-03/manual-bow-q/minimal-remount-failure.json";
const saved = JSON.parse(readFileSync(path, "utf8")).state as SettlementSaveV1;
const choice = readIslandChoice(new URLSearchParams("size=96&forest=0"), DEFAULT_ISLAND_CHOICE);
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice), seed: saved.world.seed });
const roads = createRoadNetwork(world);
const context = { actors: saved.actors, buildings: saved.buildings, options: { roads, world },
  occupied: savedOccupancy(saved).slice(), playerNation: saved.playerNation,
  reservations: new Set(saved.reservations), navigationRevision: 0 } as unknown as SettlementContext;
const soldier = saved.military!.soldiers.find(row => row.commanderId)!;
const actor = saved.actors.find(body => body.uid === soldier.actor)!;
const horse = saved.actors.find(body => body.uid === soldier.combat!.mount)!;
const points = [Math.PI / 2, -Math.PI / 2, Math.PI, 0, Math.PI * .75, -Math.PI * .75,
  Math.PI * .25, -Math.PI * .25].map(angle => {
  const point = { x: actor.x + DMath.sin(actor.yaw + angle) * .7,
    z: actor.z + DMath.cos(actor.yaw + angle) * .7 };
  return { ...point, angle, clear: isMountedNavigationClear(context, point),
    path: militaryGroundPath(context, horse, point, true) };
});
const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true, playerLevel: () => 23,
  playerNation: "nubian", roads, world });
const restored = simulation.loadState(saved);
if (restored.ok) for (let tick = 0; tick < 160 && !simulation.commanderControlSnapshot()?.mounted; tick++) {
  simulation.update(.05);
  simulation.submitCommanderInput({ generation: saved.military!.combat!.directControl!.lease!.generation,
    heading: saved.military!.combat!.directControl!.lease!.input.heading, pitch: 0, forward: 0, right: 0,
    buttons: tick === 0 ? 8 : 0 });
}
const final = simulation.saveState();
const report = { generated: { start: world.start,
  actorY: sampleSmooth(world, world.heights, actor.x, actor.z), savedActorY: actor.y,
  horseY: sampleSmooth(world, world.heights, horse.x, horse.z), savedHorseY: horse.y }, points, restored,
  finalControl: final.military?.combat?.directControl, mounted: simulation.commanderControlSnapshot()?.mounted,
  actors: final.actors.filter(body => body.uid === actor.uid || body.uid === horse.uid) };
const json = JSON.stringify(report, null, 2);
const out = process.argv.find(value => value.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, json);
console.log(json);
