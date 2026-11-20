import type { ScriptEngine } from "../../../island-of-settlers-shared/src/script/engine/engine";
import type { MapScript, ScriptEvent } from "../../../island-of-settlers-shared/src/script/types/index";
import type { ActorHandleValue } from "../../../island-of-settlers-shared/src/script/types/values";
import { createProximityWatch } from "../../src/shared/script-world/proximity-watch";
import type { ScriptMembers } from "../../src/shared/script-world/script-world-members";
import type { RoadSegment } from "../../src/shared/settlement/road-types";
import type { SettlementActor, SettlementContext } from "../../src/shared/settlement/settlement-types";

/**
 * TRG4b watch-only micro bench: a synthetic 256 × 256 island, 200 static circles (radius 6) around props, four
 * moving targets (radius 4), three bridge decks and every person walking 0.3 cells per tick. Emission is counted,
 * not delivered (no engine matching). Prints one JSON line per population.
 *
 * Usage: npx tsx tools/bench/proximity-watch-micro.ts [ticks=2000] [zones=200] [movers=4]
 */

const SIZE = 256;
const STEP = .3;
const [ticksArgument, zonesArgument, moversArgument] = process.argv.slice(2);
const ticks = Number(ticksArgument ?? 2000);
const ZONES = Number(zonesArgument ?? 200);
const MOVERS = Number(moversArgument ?? 4);

const ref = <K extends string>(kind: K, id: string) => ({ id, k: "ref" as const, kind });
const near = (kind: string, variable: string, radius: number) => ({ kind, player: { kind: "any" },
  slots: { radius: { k: "lit", type: "number", value: radius },
    target: { kind: "variable", variable: ref("variable", variable) } } }) as unknown as ScriptEvent;
const SCRIPT = { triggers: [{ events: [near("cameNear", "props", 6), near("cameNearMoving", "movers", 4),
  { kind: "bridgeStepped", player: { kind: "any" }, slots: {} }] }] } as unknown as MapScript;

const DECKS: RoadSegment[] = [40, 120, 200].flatMap((z, id) => Array.from({ length: 12 }, (_, tile) => ({
  bridge: { id, kind: "wood", tile, tiles: 12, width: 2 }, end: { x: 100.5 + tile * .5, z },
  start: { x: 100 + tile * .5, z }, tier: "stone"
}) as unknown as RoadSegment));

/** A cheap deterministic stream (the bench needs no simulation randomness). */
const createRandom = (seed: number) => () => {
  seed = Math.imul(seed ^ seed >>> 15, 2246822507) + 1 | 0;
  return ((seed ^ seed >>> 13) >>> 0) / 4294967296;
};

const run = (people: number) => {
  const random = createRandom(people);
  const actors = Array.from({ length: people }, (_, uid) => ({ job: "Carrier", phase: "walk", uid, visible: true,
    x: random() * SIZE, z: random() * SIZE }) as unknown as SettlementActor);
  const headings = actors.map(() => random() * Math.PI * 2);
  const props = Array.from({ length: ZONES }, () => ({ x: random() * SIZE, z: random() * SIZE }));
  const propHandles = props.map((_, id): ActorHandleValue => ({ generation: 0, id, space: "prop" }));
  const moverHandles = Array.from({ length: MOVERS }, (_, id): ActorHandleValue => ({ generation: 0, id,
    space: "actor" }));
  const context = { actors, buildings: [], options: { roads: { revision: 1, segments: () => DECKS },
    world: { cellsX: SIZE, cellsZ: SIZE } } } as unknown as SettlementContext;
  const engine = { script: SCRIPT, state: { actors: {}, values: {
    movers: { type: "actorGroup", value: moverHandles }, props: { type: "actorGroup", value: propHandles } } } };
  const members = { member: (handle: ActorHandleValue) => ({ actor: { family: "tree", handle, owner: null,
    type: "tree:pine" }, contained: false, hidden: false, ...props[handle.id]! }), select: () => [] };
  let events = 0;
  const watch = createProximityWatch(context, { emit: () => { events++; },
    engine: () => engine as unknown as ScriptEngine, generations: new Map(), live: () => true,
    members: members as unknown as ScriptMembers })!;
  let watchMs = 0;
  for (let tick = 0; tick < ticks; tick++) {
    actors.forEach((actor, index) => {
      if (random() < .02) headings[index] = random() * Math.PI * 2;
      actor.x = Math.min(SIZE - .01, Math.max(0, actor.x + Math.cos(headings[index]!) * STEP));
      actor.z = Math.min(SIZE - .01, Math.max(0, actor.z + Math.sin(headings[index]!) * STEP));
    });
    const started = performance.now();
    watch.update();
    watchMs += performance.now() - started;
  }
  return { decks: 3, events, eventsPerTick: Number((events / ticks).toFixed(1)), movers: MOVERS,
    msPerTick: Number((watchMs / ticks).toFixed(4)), people, ticks, zones: ZONES };
};

for (const people of [600, 2000, 5000]) console.log(JSON.stringify(run(people)));
