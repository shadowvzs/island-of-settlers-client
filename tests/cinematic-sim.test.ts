import { describe, expect, it, vi } from "vitest";

import type { MapRegion } from "../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  CinematicSequence, CinematicStep
} from "../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { MapScript, ScriptAction } from "../../island-of-settlers-shared/src/script/types/index";
import { inCinematicMode, sequence } from "../../island-of-settlers-shared/tests/cinematic-fixtures";
import {
  doStep, emptyScript, num, numberVariable, ref, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createCinematicWorldBridge } from "../src/app/campaign/cinematics/cinematic-world-bridge";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { advance } from "./helpers/military-assault-fixture";

/**
 * CIN4 on real simulations: the hold sequence's world steps as recorded commands (replay parity), skip = watch,
 * reload mid-sequence = skip with the same hash, offline catch-up while held, guaranteed mode and the member lock of
 * a running-world sequence, and the time-of-day step as a world step on a world-environment island (ENV0).
 */

const START: MapRegion = { id: "region-start", name: "start", shape: { kind: "rect", maxX: 22, maxZ: 22, minX: 18,
  minZ: 18 } };
/** The headquarters stands on the start point: no free place there without guaranteed mode. */
const HQ: MapRegion = { id: "region-hq", name: "hq", shape: { facing: 0, kind: "point", x: 6.5, z: 6.5 } };

const spawn = (id: string, region: MapRegion): CinematicStep => ({
  actorRef: "guards", delayMs: 0, id, kind: "spawn", object: { count: 2, grantToPlayer: true, kind: "unit",
    unitType: "shield" }, regionId: region.id, start: "afterPrevious"
});
const face: CinematicStep = { actorRef: "guards", delayMs: 0, facing: Math.PI / 2, id: "w2", kind: "face",
  start: "afterPrevious" };
const evening: CinematicStep = { delayMs: 0, hour: 18, id: "w3", kind: "timeOfDay", start: "afterPrevious" };

const play = (id: string): ScriptAction => doStep("p1", "playSequence", { sequence: ref("sequence", id) },
  { wait: { onFail: "continue", timeoutSeconds: 60 } });
const after = doStep("p2", "increaseVariable", { amount: num(1), variable: ref("variable", "after") });
/** Never fires: it only makes the script own a world environment (ENV0 `scriptReadsEnvironment`). */
const readsHour = trigger("t-env", { actions: [doStep("e1", "timeOfDay", { hour: num(6) })], enabled: false });

const scriptOf = (cinematic: CinematicSequence, environment = false): MapScript => emptyScript({
  regions: [START, HQ], sequences: [cinematic],
  triggers: [trigger("t-play", { actions: [play(cinematic.id), after] }), ...(environment ? [readsHour] : [])],
  variables: [numberVariable("after", "after")]
});

const HOLD = sequence("seq-hold", { steps: inCinematicMode([spawn("w1", START), face]) });

const islandWith = (script: MapScript) => createBalanceSimulation(48, 123, undefined, world => {
  world.script = structuredClone(script);
  world.themeWeights ??= new Uint8Array(0);
});

/** The island after its first ticks (the map start trigger queued the sequence). */
const started = (script: MapScript = scriptOf(HOLD)) => {
  const sim = islandWith(script);
  advance(sim, .1);
  return sim;
};

/** A bridge made when the island opened, before the sequence started (a live start, not a restored one). */
const startedWithBridge = (script: MapScript = scriptOf(HOLD)) => {
  const sim = islandWith(script);
  const bridge = createCinematicWorldBridge(() => sim);
  advance(sim, .1);
  return { bridge, sim };
};

const hashOf = (sim: SettlementSimulation) => hashText(canonicalJson(sim.saveState()));
const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[id]?.value;
const guards = (sim: SettlementSimulation) =>
  sim.militarySoldiers().filter(soldier => soldier.combat?.faction === 0 && soldier.combat.type === "shield");

const fakePlayer = () => ({ clear: vi.fn(), notifyArrived: vi.fn(), play: vi.fn(() => true) });

describe("CIN4 simulation hold and world-step commands", () => {
  it("a held sequence: the bridge plays it, world steps are recorded commands and replay to the same checksum", () => {
    const { bridge, sim } = startedWithBridge();
    const base = sim.saveState();
    const replica = islandWith(scriptOf(HOLD));
    expect(replica.loadState(structuredClone(base)).ok).toBe(true);
    const recorder = createCommandLogRecorder(sim, { sourceVersion: "test" });
    recorder.open();
    const player = fakePlayer();
    bridge.sync(player);
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ id: "seq-hold" }), expect.anything());
    expect(bridge.holds()).toBe(true);
    const tick = sim.gameTick();
    for (const step of HOLD.steps) bridge.port.applyStep("seq-hold", step);
    expect(guards(sim)).toHaveLength(2);
    expect(guards(sim).every(soldier => sim.script()!.isInvulnerable(soldier.actor))).toBe(true);
    bridge.port.endSequence("seq-hold", false);
    expect(sim.gameTick()).toBe(tick);
    expect(bridge.holds()).toBe(false);
    expect(valueOf(sim, "after")).toBe(1);
    advance(sim, 1);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => [entry.tick, entry.command.name])).toEqual([
      [tick, "applyCinematicStep"], [tick, "applyCinematicStep"], [tick, "endCinematic"]
    ]);
    expect(replayCommandLog(replica, interval)).toEqual({ endChecksum: interval.endChecksum, ok: true });
    expect(hashOf(replica)).toBe(hashOf(sim));
  }, 120_000);

  it("a skipped and a watched sequence reach the same settlement hash", () => {
    const watched = started(), skipped = started();
    for (const step of HOLD.steps) watched.applyCinematicStep("seq-hold", step.id);
    watched.endCinematic("seq-hold", false);
    expect(skipped.endCinematic("seq-hold", true)).toBe(true);
    expect(hashOf(skipped)).toBe(hashOf(watched));
    advance(watched, 2);
    advance(skipped, 2);
    expect(hashOf(skipped)).toBe(hashOf(watched));
  }, 120_000);

  it("a save mid-sequence reloads to the same hash; the reload skips it like a skipped run", () => {
    const live = started();
    live.applyCinematicStep("seq-hold", "w1");
    const saved = live.saveState();
    const reloaded = islandWith(scriptOf(HOLD));
    expect(reloaded.loadState(structuredClone(saved)).ok).toBe(true);
    expect(hashOf(reloaded)).toBe(hashOf(live));
    const player = fakePlayer();
    const bridge = createCinematicWorldBridge(() => reloaded);
    bridge.sync(player);
    expect(player.play).not.toHaveBeenCalled();
    expect(reloaded.activeCinematic()).toBeNull();
    live.endCinematic("seq-hold", true);
    expect(hashOf(reloaded)).toBe(hashOf(live));
  }, 120_000);

  it("offline catch-up advances the world, not the held sequence; the first live frame skips it", () => {
    const sim = started();
    const tick = sim.gameTick(), scriptTick = sim.script()!.engine.state.scriptTick;
    sim.setScriptMode("catchUp");
    advance(sim, 30);
    sim.endScriptCatchUp();
    expect(sim.gameTick()).toBe(tick + 600);
    expect(sim.script()!.engine.state.scriptTick).toBe(scriptTick);
    expect(sim.activeCinematic()?.sequenceId).toBe("seq-hold");
    createCinematicWorldBridge(() => sim).sync(fakePlayer());
    expect(sim.activeCinematic()).toBeNull();
    expect(guards(sim)).toHaveLength(2);
  }, 120_000);

  it("a running-world sequence: guaranteed mode, members locked and invulnerable until it ends", () => {
    const running = sequence("seq-run", { pauseWorld: false, steps: inCinematicMode([spawn("w1", HQ)]) });
    const sim = started(scriptOf(running));
    expect(sim.cinematicHold()).toBe(false);
    expect(sim.applyCinematicStep("seq-run", "w1")).toBe(true);
    const [member] = guards(sim).map(soldier => soldier.actor);
    expect(member).toBeDefined();
    expect(sim.script()!.isInvulnerable(member!)).toBe(true);
    expect(sim.storyLockedSoldiers([member!])).toEqual([member]);
    expect(sim.commandMilitary([member!], { x: 20.5, z: 20.5 }, "move")).toBe(false);
    advance(sim, 1);
    expect(sim.script()!.engine.state.quests).toBeDefined();
    sim.endCinematic("seq-run", false);
    expect(sim.script()!.isInvulnerable(member!)).toBe(false);
    expect(sim.commandMilitary([member!], { x: 20.5, z: 20.5 }, "move")).toBe(true);
  }, 120_000);

  it("time of day is a world step on a world-environment island, presentation elsewhere", () => {
    const withHour = sequence("seq-hour", { steps: inCinematicMode([evening]) });
    const plain = started(scriptOf(withHour));
    const bridgePlain = createCinematicWorldBridge(() => plain);
    expect(bridgePlain.port.ownsStep!(evening)).toBe(false);
    expect(plain.applyCinematicStep("seq-hour", "w3")).toBe(false);

    const { bridge, sim } = startedWithBridge(scriptOf(withHour, true));
    expect(bridge.port.ownsStep!(evening)).toBe(true);
    const before = sim.script()!.environmentReading()!.hour;
    bridge.sync(fakePlayer());
    bridge.port.applyStep("seq-hour", evening);
    expect(sim.script()!.environmentReading()!.hour).toBeCloseTo(before, 6);
    bridge.track(.1);
    expect(bridge.heldTicks()).toBe(2);
    const shown = sim.script()!.environmentReading(0, 40)!.hour;
    expect(shown).toBeGreaterThan(before);
    expect(shown).toBeLessThan(18);
    bridge.port.endSequence("seq-hour", false);
    expect(sim.script()!.environmentReading()!.hour).toBeCloseTo(18, 6);

    const skipped = started(scriptOf(withHour, true));
    skipped.endCinematic("seq-hour", true);
    expect(hashOf(skipped)).toBe(hashOf(sim));
  }, 120_000);
});
