import { describe, expect, it } from "vitest";

import type { MapRegion } from "../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  MapScript, ScriptAction, ScriptEvent, ScriptTrigger, ScriptVariable
} from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, escortArcher, num, numberVariable, player1, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { advance } from "./helpers/military-assault-fixture";

/**
 * TRG5a presence and movement actions on real simulations: §14.2 end to end, the overridable/locked matrix
 * (player orders, CPU orders), spawn/fade/hide/kill/owner/invulnerable, teleport region events through the TRG4
 * watch, save/load mid-action and catch-up (skip modes run no script and resume on the first live tick).
 */

const rect = (id: string, minX: number, minZ: number, maxX: number, maxZ: number): MapRegion =>
  ({ id, name: id, shape: { kind: "rect", maxX, maxZ, minX, minZ } });

const START = rect("region-start", 18, 18, 22, 22);
const GOAL = rect("region-goal", 32, 32, 35, 35);
const ENEMY = rect("region-enemy", 24, 18, 27, 21);

const groupVar = (id: string): ScriptVariable =>
  ({ id, initial: { type: "actorGroup", value: [] }, maxLength: 16, name: id, type: "actorGroup" });
const stringVar = (id: string): ScriptVariable => ({ id, initial: { type: "string", value: "" }, name: id,
  type: "string" });
const units = (id: string) => ({ kind: "variable" as const, variable: ref("variable", id) });
const saveOutcome = (id: string): ScriptAction =>
  doStep(`${id}-out`, "setVariable", { value: { k: "resp", key: "outcome" }, variable: ref("variable", id) });
const waitFor = (seconds: number) => ({ wait: { onFail: "continue" as const, timeoutSeconds: seconds } });

const spawnStep = (id: string, region: MapRegion, owner = player1, extra: Record<string, unknown> = {}) =>
  doStep(id, "spawn", { at: ref("region", region.id), count: num(1), owner, store: ref("variable", "squad"),
    type: { type: ref("content", "soldier:shield") }, ...extra });

const islandWith = (script: MapScript) => createBalanceSimulation(48, 123, undefined, world => { world.script = script; });

const valueOf = (sim: SettlementSimulation, id: string) => sim.script()!.engine.state.values[id]?.value;
const squadOf = (sim: SettlementSimulation) =>
  (valueOf(sim, "squad") as { id: number }[]).map(handle => handle.id);
const actorOf = (sim: SettlementSimulation, uid: number) => sim.frames().find(actor => actor.uid === uid);
const inside = (sim: SettlementSimulation, uid: number, region: MapRegion) => {
  const actor = actorOf(sim, uid)!, shape = region.shape as Extract<MapRegion["shape"], { kind: "rect" }>;
  return actor.x >= shape.minX && actor.x <= shape.maxX + 1 && actor.z >= shape.minZ && actor.z <= shape.maxZ + 1;
};

/** Spawns one shield soldier at the start, then moves it to the goal and records the outcome. */
const moveScript = (overridable: boolean, owner = player1) => emptyScript({
  regions: [START, GOAL, ENEMY],
  triggers: [trigger("t-move", { actions: [
    spawnStep("s1", owner.faction === 0 ? START : ENEMY, owner),
    doStep("s2", "move", { actor: units("squad"), region: ref("region", GOAL.id), stance: str("passive") },
      { overridable, ...waitFor(120) }),
    saveOutcome("moved")
  ] })],
  variables: [groupVar("squad"), stringVar("moved")]
});

describe("TRG5a presence and movement actions", () => {
  it("§14.2 escort: the archer appears as a Nubian rank 2, the player leads it and the quest succeeds", () => {
    const script = escortArcher();
    script.regions = [rect("region-1", 18, 18, 22, 22), rect("region-7", 32, 32, 35, 35)];
    const sim = islandWith(script);
    advance(sim, 2);
    const engine = sim.script()!.engine;
    expect(engine.state.quests.escort?.state).toBe("active");
    const binding = engine.state.actors["actor-4"]!;
    expect(binding.incarnation).toBe(1);
    expect(binding.members).toHaveLength(1);
    const archer = binding.members[0]!.handle.id;
    const soldier = sim.militarySoldiers().find(entry => entry.actor === archer)!;
    expect(soldier).toMatchObject({ combat: { faction: 0, type: "archer" }, rank: 2 });
    expect(sim.script()!.actions.lookOf(archer)).toBe("nubian");
    // `playSequence` (CIN4) holds the quest's run until the intro sequence ends (the player's recorded end).
    expect(sim.activeCinematic()?.sequenceId).toBe("seq-archer-intro");
    expect(sim.endCinematic("seq-archer-intro", false)).toBe(true);
    expect(sim.commandMilitary([archer], { x: 33.5, z: 33.5 }, "move")).toBe(true);
    for (let second = 0; second < 90 && engine.state.quests.escort?.state === "active"; second++) advance(sim, 1);
    expect(engine.state.quests.escort?.state).toBe("succeeded");
    // A visible quest runs `onSuccess` when the player claims it (the recorded claim command's engine step).
    engine.claimQuest("escort");
    advance(sim, 1);
    const presentation = sim.script()!.actions.presentation();
    expect(presentation.speech.map(line => ({ actor: line.actor, en: line.text.en, speaker: line.speaker })))
      .toEqual([{ actor: archer, en: "We made it. Thank you!", speaker: "archer" }]);
  }, 240_000);

  it("§14.2 failure: the archer dies, the quest fails", () => {
    const script = escortArcher();
    script.regions = [rect("region-1", 18, 18, 22, 22), rect("region-7", 32, 32, 35, 35)];
    script.triggers = [trigger("t-kill", { actions: [{ id: "k0", k: "wait", seconds: num(1) }, doStep("k1", "kill", {
      actor: { actor: ref("actor", "actor-4"), kind: "instance" } })],
    events: [{ kind: "questActivated", player: { kind: "any" }, slots: { quest: ref("quest", "escort") } }] })];
    const sim = islandWith(script);
    advance(sim, 4);
    expect(sim.script()!.engine.state.quests.escort?.state).toBe("failed");
    expect(sim.script()!.engine.state.actors["actor-4"]!.lastExit).toBe("died");
  }, 120_000);

  it("locked (overridable false): player orders are refused, the move completes, then the unit is free", () => {
    const sim = islandWith(moveScript(false));
    advance(sim, 1);
    const [uid] = squadOf(sim);
    expect(sim.storyLockedSoldiers([uid!])).toEqual([uid]);
    expect(sim.commandMilitary([uid!], { x: 10.5, z: 10.5 }, "move")).toBe(false);
    expect(sim.returnMilitaryHome([uid!])).toBe(false);
    for (let second = 0; second < 90 && valueOf(sim, "moved") === ""; second++) advance(sim, 1);
    expect(valueOf(sim, "moved")).toBe("done");
    expect(inside(sim, uid!, GOAL)).toBe(true);
    expect(sim.storyLockedSoldiers([uid!])).toEqual([]);
    expect(sim.commandMilitary([uid!], { x: 20.5, z: 20.5 }, "move")).toBe(true);
  }, 240_000);

  it("overridable (default): the player's order wins and the story action ends interrupted", () => {
    const sim = islandWith(moveScript(true));
    advance(sim, 1);
    const [uid] = squadOf(sim);
    expect(sim.storyLockedSoldiers([uid!])).toEqual([]);
    expect(sim.commandMilitary([uid!], { x: 12.5, z: 12.5 }, "move")).toBe(true);
    advance(sim, 1);
    expect(valueOf(sim, "moved")).toBe("interrupted");
  }, 120_000);

  it("CPU orders skip a story-controlled computer soldier until its action ends", () => {
    const sim = islandWith(moveScript(false, { faction: 1, kind: "slot" }));
    advance(sim, 1);
    const [uid] = squadOf(sim);
    expect(sim.militarySoldiers().find(entry => entry.actor === uid)?.combat?.faction).toBe(1);
    expect(sim.commandMilitaryOpponent([uid!], { x: 10.5, z: 10.5 }, 1, "move")).toBe(false);
    for (let second = 0; second < 90 && valueOf(sim, "moved") === ""; second++) advance(sim, 1);
    expect(valueOf(sim, "moved")).toBe("done");
    expect(sim.commandMilitaryOpponent([uid!], { x: 26.5, z: 19.5 }, 1, "move")).toBe(true);
  }, 240_000);

  it("spawn with fade, hide/unhide, invulnerable, owner change, fade out + remove, kill", () => {
    const steps: ScriptAction[] = [
      spawnStep("p1", START, player1, { count: num(3), fadeMs: num(1000) }),
      { id: "p2", k: "wait", seconds: num(2) },
      doStep("p3", "hide", { actor: units("squad"), hidden: { k: "lit", type: "boolean", value: true } }),
      { id: "p4", k: "wait", seconds: num(1) },
      doStep("p5", "fade", { actor: units("squad"), ms: num(500), then: str("keep") }, waitFor(5)),
      doStep("p6", "setInvulnerable", { actor: units("squad"), on: { k: "lit", type: "boolean", value: true } }),
      doStep("p7", "setOwner", { actor: { kind: "query", query: { from: units("squad"), pick: { kind: "first" } } },
        owner: { faction: 2, kind: "slot" } }),
      doStep("p8", "despawn", { actor: { kind: "query", query: { from: units("squad"), pick: { kind: "first" } } },
        fadeMs: num(500) }, waitFor(5)),
      doStep("p9", "kill", { actor: units("squad"), count: num(1) })
    ];
    const counted = (id: string, kind: ScriptEvent["kind"]): ScriptTrigger => trigger(id, { actions: [
      doStep(`${id}-1`, "increaseVariable", { amount: num(1), variable: ref("variable", id) })],
    events: [{ kind, player: { kind: "any" }, slots: {} }] });
    const sim = islandWith(emptyScript({ regions: [START], triggers: [trigger("t-p", { actions: steps }),
      counted("killed", "actorKilled"), counted("gone", "actorGone")],
    variables: [groupVar("squad"), numberVariable("killed", "killed"), numberVariable("gone", "gone")] }));
    advance(sim, .5);
    const squad = squadOf(sim);
    expect(squad).toHaveLength(3);
    const fades = sim.script()!.actions.presentation().fades;
    expect(fades.map(fade => fade.actor)).toEqual(squad);
    expect(fades.every(fade => fade.opacity > 0 && fade.opacity < 1)).toBe(true);
    advance(sim, 2.2);
    expect(squad.every(uid => actorOf(sim, uid)?.visible === false)).toBe(true);
    // Hidden units are not matched by type selectors (design §3.2).
    const count = sim.script()!.engine.port.callFunction("count", { selector: { kind: "type", owner: player1,
      type: { type: ref("content", "soldier:shield") } } as never }, { evaluate: () => null, resolveActors: () => [],
      runId: null });
    expect(count).toBe(0);
    advance(sim, 3);
    expect(sim.script()!.isInvulnerable(squad[1]!)).toBe(true);
    expect(sim.militarySoldiers().find(entry => entry.actor === squad[0])).toBeUndefined();
    expect(valueOf(sim, "gone")).toBe(2);
    expect(valueOf(sim, "killed")).toBe(1);
    expect(squadOf(sim)).toHaveLength(1);
  }, 120_000);

  it("teleport into a watched region announces the enter through the region watch", () => {
    const entered: ScriptTrigger = trigger("t-in", { actions: [doStep("i1", "increaseVariable",
      { amount: num(1), variable: ref("variable", "in") })],
    events: [{ kind: "enteredRegion", player: { kind: "any" }, slots: { region: ref("region", GOAL.id) } }] });
    const sim = islandWith(emptyScript({ regions: [START, GOAL], triggers: [trigger("t-tp", { actions: [
      spawnStep("t1", START), { id: "t2", k: "wait", seconds: num(1) },
      doStep("t3", "teleport", { actor: units("squad"), facing: num(90), region: ref("region", GOAL.id) })
    ] }), entered], variables: [groupVar("squad"), numberVariable("in", "in")] }));
    advance(sim, 1.5);
    expect(valueOf(sim, "in")).toBe(1);
    const [uid] = squadOf(sim);
    expect(inside(sim, uid!, GOAL)).toBe(true);
    expect(actorOf(sim, uid!)!.yaw).toBeCloseTo(Math.PI / 2);
  }, 120_000);

  it("save/load mid-move continues identically; catch-up freezes the action until the first live tick", () => {
    const live = islandWith(moveScript(false));
    advance(live, 3);
    const saved = live.saveState();
    expect(saved.scriptRun?.actions?.units).toHaveLength(1);
    const reloaded = islandWith(moveScript(false));
    expect(reloaded.loadState(structuredClone(saved)).ok).toBe(true);
    for (let second = 0; second < 60; second++) { advance(live, 1); advance(reloaded, 1); }
    expect(valueOf(reloaded, "moved")).toBe("done");
    expect(reloaded.script()!.engine.hash()).toBe(live.script()!.engine.hash());

    const offline = islandWith(moveScript(false));
    advance(offline, 1);
    offline.setScriptMode("catchUp");
    advance(offline, 60);
    expect(valueOf(offline, "moved")).toBe("");
    offline.endScriptCatchUp();
    advance(offline, .1);
    expect(valueOf(offline, "moved")).toBe("done");
  }, 240_000);

  it("guaranteed mode spawns next to a blocked point instead of failing", () => {
    // The headquarters stands on the start point: no free place there.
    const water = { id: "region-hq", name: "hq", shape: { facing: 0, kind: "point", x: 6.5, z: 6.5 } } as MapRegion;
    const script = emptyScript({ regions: [water], triggers: [trigger("t-g", { actions: [
      spawnStep("g1", water), saveOutcome("spawned")
    ] })], variables: [groupVar("squad"), stringVar("spawned")] });
    const normal = islandWith(structuredClone(script));
    advance(normal, .5);
    expect(squadOf(normal)).toEqual([]);
    const guaranteed = islandWith(structuredClone(script));
    guaranteed.script()!.setGuaranteed(true);
    advance(guaranteed, .5);
    expect(squadOf(guaranteed)).toHaveLength(1);
  }, 120_000);
});
