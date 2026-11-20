import { describe, expect, it } from "vitest";

import { scheduleSequence } from "../../island-of-settlers-shared/src/campaign/cinematics/schedule";
import type {
  CinematicSequence, CinematicStep
} from "../../island-of-settlers-shared/src/campaign/cinematics/types";
import { createFixtureSequence } from "../src/app/campaign/cinematics/fixture-sequence-data";
import type { CinematicPlayerPorts } from "../src/app/campaign/cinematics/ports";
import { createSequencePlayer } from "../src/app/campaign/cinematics/sequence-player";
import type { CameraOrbit } from "../src/render-common/cinematic/cinematic-frame";

const START: CameraOrbit = { distance: 80, fov: 0.52, pitch: 0.9, targetX: 64, targetY: 2, targetZ: 64, yaw: 0.3 };
const FRAME_SECONDS = 1 / 60;

const createPorts = () => {
  const log: string[] = [];
  let clock = () => 0;
  const at = (event: string) => log.push(`${Math.round(clock())}:${event}`);
  const ports: CinematicPlayerPorts = {
    effects: {
      strikeLightning: (x, z) => at(`strike ${Math.round(x)},${Math.round(z)}`),
      weather: (state, ms) => at(`weather ${state} ${ms}`)
    },
    language: () => "en",
    mode: { enter: () => at("enter"), exit: () => at("exit") },
    msPerChar: () => 60,
    view: { cellsX: 128, cellsZ: 128, drawnOrbit: () => START, groundHeight: () => 2 },
    world: {
      applyStep: (sequenceId, step) => at(`world ${sequenceId}/${step.id}`),
      endSequence: (sequenceId, skipped) => at(`end ${sequenceId} ${skipped ? "skipped" : "watched"}`)
    }
  };
  return { log, ports, setClock: (next: () => number) => { clock = next; } };
};

const createHarness = () => {
  const fake = createPorts();
  const player = createSequencePlayer(fake.ports);
  fake.setClock(() => player.state().nowMs);
  const run = (seconds: number, step = FRAME_SECONDS) => {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) player.update(step);
  };
  return { ...fake, player, run };
};

const sequence = (id: string, steps: CinematicStep[], pauseWorld = true): CinematicSequence =>
  ({ id, name: id, pauseWorld, skippable: true, steps });

const modeOn: CinematicStep = { delayMs: 0, id: "on", kind: "cinematicMode", letterbox: true, on: true,
  start: "afterPrevious", transitionMs: 500 };
const spawn: CinematicStep = { delayMs: 1000, id: "spawn", kind: "spawn", object: { decorationId: "tree",
  kind: "decoration" }, regionId: "r", start: "afterPrevious" };
const weather: CinematicStep = { delayMs: 500, id: "rain", kind: "weather", start: "afterPrevious", state: "rain",
  transitionMs: 3000 };
const EMPTY_CONTEXT = { regions: [], shots: [], speakers: [] };

describe("cinematic sequence player", () => {
  it("starts the owner example's steps at their scheduled ms and restores at the end", () => {
    const harness = createHarness();
    const fixture = createFixtureSequence(START, () => 2);
    const timings = scheduleSequence(fixture.sequence.steps, { language: "en", msPerChar: 60 });
    harness.player.play(fixture.sequence, fixture.context);
    expect(harness.player.locksInput()).toBe(true);
    expect(harness.player.holdsWorld()).toBe(true);
    const strikeIndex = fixture.sequence.steps.findIndex(entry => entry.id === "strike");
    const strikeMs = timings[strikeIndex]!.startMs;
    harness.run(strikeMs / 1000 + 0.5);
    const strikes = harness.log.filter(entry => entry.includes("strike"));
    // Two strikes at the ridge, 220 ms apart, starting on the first frame at or after the scheduled start.
    expect(strikes).toHaveLength(2);
    expect(Number(strikes[0]!.split(":")[0]) - strikeMs).toBeLessThan(17);
    expect(strikes[0]).toContain("80,52");
    expect(harness.player.frame()?.glints).toHaveLength(1);
    harness.run(30);
    expect(harness.player.active()).toBe(false);
    const endMs = Math.max(...timings.map(timing => timing.endMs));
    const exit = harness.log.find(entry => entry.endsWith("exit"))!;
    expect(Math.abs(Number(exit.split(":")[0]) - endMs)).toBeLessThan(17);
    expect(harness.log.at(-1)).toMatch(/end cin3-owner-example watched$/u);
    expect(harness.player.holdsWorld()).toBe(false);
    expect(harness.player.frame()).toBeUndefined();
  });

  it("re-anchors on a clicked-away line and holds a click-only line", () => {
    const harness = createHarness();
    const speak: CinematicStep = { delayMs: 0, id: "line", kind: "speak", speakerId: "advisor", start: "afterPrevious",
      text: { en: "Short line." }, timing: "auto", waitForClick: true };
    harness.player.play(sequence("talk", [modeOn, speak, spawn]), EMPTY_CONTEXT);
    harness.run(20);
    expect(harness.log.some(entry => entry.includes("world"))).toBe(false);
    expect(harness.player.presentation.ui.getSnapshot().speech?.phase).toBe("playing");
    expect(harness.player.advance()).toBe(true);
    const clickedMs = harness.player.state().nowMs;
    harness.run(1.2);
    const world = harness.log.find(entry => entry.includes("world"))!;
    expect(Math.abs(Number(world.split(":")[0]) - (clickedMs + 1000))).toBeLessThan(17);
  });

  it("skips with two presses only, finishing every step at its end state", () => {
    const harness = createHarness();
    harness.player.play(sequence("skip", [modeOn, spawn, weather]), EMPTY_CONTEXT);
    harness.run(0.2);
    harness.player.pressSkip();
    expect(harness.player.active()).toBe(true);
    expect(harness.player.presentation.ui.getSnapshot().skipPrompt).toBe(true);
    // The prompt expires after 3 s; a late second press only arms it again. The weather fade (begun at 2 s)
    // jumps to its end state on the skip.
    harness.run(3.1);
    expect(harness.player.presentation.ui.getSnapshot().skipPrompt).toBe(false);
    harness.player.pressSkip();
    harness.player.pressSkip();
    expect(harness.player.active()).toBe(false);
    expect(harness.log.filter(entry => !entry.includes("world")).map(entry => entry.split(":")[1])).toEqual([
      "enter", "weather rain 3000", "weather rain 0", "exit", "end skip skipped"
    ]);
    expect(harness.player.presentation.visual.getSnapshot()).toEqual({ fade: 0, letterbox: 0 });
  });

  it("plays one sequence at a time; victory preempts and drops pending story sequences", () => {
    const harness = createHarness();
    harness.player.play(sequence("a", [modeOn, spawn]), EMPTY_CONTEXT);
    harness.player.play(sequence("b", [modeOn]), EMPTY_CONTEXT);
    expect(harness.player.state()).toMatchObject({ pending: ["b"], sequenceId: "a" });
    harness.run(0.2);
    harness.player.play(sequence("victory", [modeOn]), EMPTY_CONTEXT, "outcome");
    expect(harness.player.state()).toMatchObject({ pending: [], sequenceId: "victory" });
    expect(harness.log).toContain("200:end a skipped");
    expect(harness.player.play(sequence("late", [modeOn]), EMPTY_CONTEXT)).toBe(false);
    harness.run(2);
    expect(harness.log.at(-1)).toMatch(/end victory watched$/u);
    expect(harness.player.active()).toBe(false);
  });

  it("holds the world only for a paused sequence", () => {
    const harness = createHarness();
    harness.player.play(sequence("running", [modeOn], false), EMPTY_CONTEXT);
    expect(harness.player.active()).toBe(true);
    expect(harness.player.holdsWorld()).toBe(false);
  });

  it("never advances more than 0.1 s on a hidden-tab resume", () => {
    const harness = createHarness();
    harness.player.play(sequence("hidden", [modeOn, spawn]), EMPTY_CONTEXT);
    harness.player.update(600);
    expect(harness.player.state().nowMs).toBe(100);
    harness.player.update(Number.NaN);
    harness.player.update(-5);
    expect(harness.player.state().nowMs).toBe(100);
  });
});
