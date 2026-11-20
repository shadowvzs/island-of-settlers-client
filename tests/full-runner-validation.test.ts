import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { requireQuestPrerequisite } from "../tools/e2e/full/quest-prerequisites";
import { recordingReplayLimit, validateExportedRecording } from "../tools/e2e/full/recording-validation";
import { MissingPrerequisite } from "../tools/e2e/full/report";

describe("full runner prerequisite and recording evidence classification", () => {
  it("blocks absent quest setup without swallowing actual assertion failures", () => {
    expect(() => requireQuestPrerequisite(false, "No eligible daily")).toThrow(MissingPrerequisite);
    expect(() => requireQuestPrerequisite(true, "Ready")).not.toThrow();
    const actualDefect = new Error("Reward duplicated");
    expect(actualDefect).not.toBeInstanceOf(MissingPrerequisite);
  });

  it("retains unsupported exported reports with an explicit blocked artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "settlers-recording-validation-"));
    const filename = join(directory, "recording.json");
    const original = JSON.stringify({ format: "island-settlers-bug-replay", version: 1,
      scene: [], gaps: ["Island visit"], limited: false });
    try {
      await writeFile(filename, original);
      await expect(validateExportedRecording(filename)).rejects.toBeInstanceOf(MissingPrerequisite);
      expect(await readFile(filename, "utf8")).toBe(original);
      const evidence = JSON.parse(await readFile(`${filename}.validation.json`, "utf8"));
      expect(evidence.outcome).toBe("blocked");
      expect(evidence.reason).toContain("Island visit");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains replay comparison/output on endpoint failure and diagnostics for invalid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "settlers-recording-mismatch-"));
    const filename = join(directory, "recording.json");
    try {
      await writeFile(filename, JSON.stringify({ format: "island-settlers-bug-replay", version: 1,
        scene: [], limited: false }));
      const stdout = JSON.stringify({ endpointMatches: false, outcomeDifferences: 2 });
      await expect(validateExportedRecording(filename, async () => ({ stdout, stderr: "diagnostic" })))
        .rejects.toThrow("diverged");
      let evidence = JSON.parse(await readFile(`${filename}.validation.json`, "utf8"));
      expect(evidence).toMatchObject({ outcome: "fail", stdout, stderr: "diagnostic",
        comparison: { endpointMatches: false, outcomeDifferences: 2 } });
      await writeFile(filename, "broken JSON");
      await expect(validateExportedRecording(filename)).rejects.toThrow(/JSON/);
      evidence = JSON.parse(await readFile(`${filename}.validation.json`, "utf8"));
      expect(evidence.outcome).toBe("fail");
      expect(evidence.error).toContain("SyntaxError");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("accepts complete empty scene journals but never calls partial or legacy captures verified", () => {
    expect(recordingReplayLimit({ scene: [], limited: false })).toBeNull();
    expect(recordingReplayLimit({ scene: [], limited: true })).toContain("limit");
    expect(recordingReplayLimit({ scene: [], limited: false, gaps: ["Island visit"] })).toContain("Island visit");
    expect(recordingReplayLimit({ limited: false })).toContain("Legacy");
  });
});
