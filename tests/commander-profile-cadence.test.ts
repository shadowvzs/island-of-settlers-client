import { describe, expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON } from "../../island-of-settlers-shared/src/commander-input";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { MILITARY_PROFILES } from "../src/shared/balance/military";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { fightingType } from "../src/shared/settlement/military-combat-rules";
import { commanderProfileSession } from "./helpers/commander-profile-session";

const NATIONS: readonly WorkerNation[] = [
  "chinese", "indigenous", "japanese", "maya", "nubian", "persian", "roman", "viking"
];
const CASES = NATIONS.flatMap(nation => [true, false].map(mounted => ({ mounted, nation })));

describe("all catalogue commander profiles on foot and mounted", () => {
  it.each(CASES.filter(row => ["roman", "viking", "nubian"].includes(row.nation)))(
    "keeps cooldown across cancel/re-entry, guard, mount request and restore: $nation $mounted", config => {
      const f = commanderProfileSession(config.nation, config.mounted);
      const ranged = fightingType(f.state()) === "archer";
      const enemy = f.simulation.spawnMilitaryOpponent({ x: f.body().x, z: f.body().z + (ranged ? 4 : .9) }, "shield");
      expect(enemy).not.toBeNull();
      const generation = f.begin();
      for (let tick = 0; tick < 60 && !f.state().attackTime; tick++) {
        f.simulation.update(.05);
        expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.attack, forward: ranged ? 0 : 127 })).toBe(true);
      }
      expect(f.state().attackTime).toBeGreaterThan(0);
      const cooldown = f.state().cooldown;
      expect(f.simulation.endCommanderControl(generation)).toBe(true);
      expect(f.state().cooldown).toBe(cooldown);
      expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.attack })).toBe(false);
      if (!ranged) expect(f.simulation.beginCommanderControl(f.actor).ok).toBe(false);
      while (f.state().attackTime) f.simulation.update(.05);
      const next = f.begin();
      expect(next).toBeGreaterThan(generation);
      expect(f.input(generation)).toBe(false);
      const remaining = f.state().cooldown;
      expect(remaining).toBeGreaterThan(0);
      const buttons = COMMANDER_INPUT_BUTTON.block |
        (config.mounted ? COMMANDER_INPUT_BUTTON.dismount : COMMANDER_INPUT_BUTTON.callHorse);
      f.simulation.update(.05);
      expect(f.input(next, { buttons })).toBe(true);
      f.simulation.update(.05);
      expect(f.state().cooldown).toBeCloseTo(Math.max(0, remaining - .1), 10);
      const snapshot = f.simulation.saveState();
      expect(f.simulation.loadState(snapshot)).toEqual({ ok: true });
      expect(f.state().cooldown).toBeCloseTo(Math.max(0, remaining - .1), 10);
      expect(f.input(generation)).toBe(false);
    }
  );

  it.each(CASES)("uses the same cadence/facing in ordinary AI combat: $nation $mounted", config => {
    const f = commanderProfileSession(config.nation, config.mounted);
    const ranged = fightingType(f.state()) === "archer";
    expect(f.simulation.spawnMilitaryOpponent({ x: f.body().x, z: f.body().z + (ranged ? 4 : 1.8) }, "shield"))
      .not.toBeNull();
    const interval = MILITARY_PROFILES[fightingType(f.state())].interval;
    const starts: number[] = [];
    for (let tick = 0; tick < 140; tick++) {
      const previousCooldown = f.state().cooldown;
      f.simulation.update(.05);
      const state = f.state();
      if (state.attackTime !== .6) {
        if (previousCooldown > .05) expect(state.cooldown).toBeCloseTo(previousCooldown - .05, 10);
        continue;
      }
      starts.push(tick);
      expect(state.cooldown).toBe(interval);
      const target = f.simulation.frames().find(body => body.uid === state.pendingTarget)!;
      expect(target).toBeDefined();
      const angle = Math.atan2(target.x - f.body().x, target.z - f.body().z) - f.body().yaw;
      expect(Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))).toBeLessThanOrEqual(.35 + 1e-8);
    }
    // Normal enemy retreat and mounted pursuit can interrupt contact; only legal attacks count as cadence samples.
    expect(starts.length).toBeGreaterThanOrEqual(1);
    for (let index = 1; index < starts.length; index++)
      expect((starts[index]! - starts[index - 1]!) * .05).toBeGreaterThanOrEqual(interval - 1e-8);
  });

  it.each(CASES)("preserves the authoritative cadence under spam/retarget/guard/save: $nation $mounted", config => {
    const f = commanderProfileSession(config.nation, config.mounted);
    const ranged = fightingType(f.state()) === "archer";
    const enemies = [-1, 1].map(side => f.simulation.spawnMilitaryOpponent({
      x: f.body().x, z: f.body().z + side * (ranged ? 4 : .9)
    }, "shield"));
    expect(enemies.every(enemy => enemy !== null)).toBe(true);
    const base = f.simulation.saveState();
    // Every recorded interval starts from its reloaded base (command-log-session.ts), as the server's replay does:
    // the A13 vision layer is rebuilt from positions on load, so the spawned opponents are seen from tick 0.
    expect(f.simulation.loadState(base)).toEqual({ ok: true });
    const recorder = createCommandLogRecorder(f.simulation, { sourceVersion: "profile-cadence-2026-11-05" });
    recorder.open();
    const generation = f.begin();
    const interval = MILITARY_PROFILES[fightingType(f.state())].interval;
    const starts: number[] = [];
    let previousAttack = 0;
    for (let tick = 0; tick < 140; tick++) {
      const previousCooldown = f.state().cooldown;
      f.simulation.update(.05);
      const state = f.state();
      if (state.attackTime === .6 && previousAttack !== .6) {
        starts.push(tick);
        expect(state.cooldown).toBe(interval);
        if (!ranged) {
          const target = f.simulation.frames().find(body => body.uid === state.pendingTarget)!;
          expect(target).toBeDefined();
          const angle = Math.atan2(target.x - f.body().x, target.z - f.body().z) - f.body().yaw;
          expect(Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))).toBeLessThanOrEqual(.35 + 1e-8);
        }
      } else if (previousCooldown > .05) {
        expect(state.cooldown).toBeCloseTo(previousCooldown - .05, 10);
      }
      previousAttack = state.attackTime ?? 0;
      const buttons = tick % 41 === 0 ? COMMANDER_INPUT_BUTTON.block : COMMANDER_INPUT_BUTTON.attack;
      const target = f.simulation.frames().find(body => body.uid === enemies[tick < 70 ? 1 : 0]);
      const angle = target ? Math.atan2(target.x - f.body().x, target.z - f.body().z) : 0;
      const heading = Math.round(((angle / (Math.PI * 2) % 1 + 1) % 1) * 65536) % 65536;
      const distance = target ? Math.hypot(target.x - f.body().x, target.z - f.body().z) : 0;
      const forward = !ranged && distance > .8 ? 127 : 0;
      const patch = { buttons, forward, heading };
      expect(f.input(generation, patch)).toBe(true);
      const cooldown = state.cooldown;
      for (let spam = 0; spam < 4; spam++) expect(f.input(generation, patch)).toBe(false);
      expect(state.cooldown).toBe(cooldown);
      if (tick === 55) {
        const snapshot = f.simulation.saveState();
        const restored = commanderProfileSession(config.nation, config.mounted);
        expect(restored.simulation.loadState(snapshot)).toEqual({ ok: true });
        expect(restored.state().cooldown).toBe(cooldown);
      }
    }
    expect(starts.length, JSON.stringify({ starts, state: f.state(), body: f.body(),
      enemies: f.simulation.frames().filter(body => enemies.includes(body.uid)) })).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < starts.length; index++)
      expect((starts[index]! - starts[index - 1]!) * .05).toBeGreaterThanOrEqual(interval - 1e-8);
    const cooldown = f.state().cooldown;
    expect(f.simulation.endCommanderControl(generation)).toBe(true);
    expect(f.state().cooldown).toBe(cooldown);
    expect(f.input(generation, { buttons: COMMANDER_INPUT_BUTTON.attack })).toBe(false);
    const log = recorder.close("home")!;
    const expected = f.simulation.saveState();
    const replay = commanderProfileSession(config.nation, config.mounted);
    expect(replay.simulation.loadState(base)).toEqual({ ok: true });
    expect(replayCommandLog(replay.simulation, log)).toMatchObject({ ok: true });
    expect(replay.simulation.saveState()).toEqual(expected);
    recorder.dispose();
  });
});
