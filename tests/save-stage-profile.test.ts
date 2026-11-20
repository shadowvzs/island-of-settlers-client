import { afterEach, expect, it } from "vitest";

import {
  appendSaveStageSamples, clearSaveStageProfile, profileSaveStage, profileSaveStageAsync,
  readSaveStageProfile
} from "../src/shared/settlement/save-stage-profile";

const flag = globalThis as { __saveStageProfile?: boolean };

afterEach(() => {
  delete flag.__saveStageProfile;
  clearSaveStageProfile();
});

it("records synchronous and asynchronous save stages only when opted in", async () => {
  clearSaveStageProfile();
  expect(profileSaveStage("disabled", () => 4)).toBe(4);
  expect(await profileSaveStageAsync("disabled-async", async () => 5)).toBe(5);
  expect(readSaveStageProfile()).toEqual([]);

  flag.__saveStageProfile = true;
  expect(profileSaveStage("capture", () => 4)).toBe(4);
  expect(await profileSaveStageAsync("encode", async () => 5)).toBe(5);
  expect(readSaveStageProfile().map(sample => sample.name)).toEqual(["capture", "encode"]);
  expect(readSaveStageProfile().every(sample => Number.isFinite(sample.ms) && sample.ms >= 0)).toBe(true);
});

it("merges worker stage samples into the caller's opt-in timeline", () => {
  appendSaveStageSamples([{ name: "worker.save.compose", ms: 2.5 }]);
  appendSaveStageSamples([{ name: "worker.save.encodeAndReport", ms: 4 }]);
  expect(readSaveStageProfile()).toEqual([
    { name: "worker.save.compose", ms: 2.5 },
    { name: "worker.save.encodeAndReport", ms: 4 }
  ]);
});
