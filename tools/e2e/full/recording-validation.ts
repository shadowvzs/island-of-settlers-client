import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FORMATS, isCurrentFormat } from "../../../../island-of-settlers-shared/src/formats";
import type { BugReplayReport } from "../../../src/shared/settlement/bug-replay";
import { isSafeTree, SAVE_TREE_DEPTH } from "../../../src/shared/settlement/save-validation";
import { MissingPrerequisite } from "./report";

const execute = promisify(execFile);

export const recordingReplayLimit = (
  report: Pick<BugReplayReport, "scene" | "gaps" | "limited">
) => {
  if (report.limited) return "Recording reached its capture limit";
  if (report.gaps?.length) return `Unsupported recorded scope: ${report.gaps.join("; ")}`;
  if (!report.scene) return "Legacy recording has no scene observation journal";
  return null;
};

const executeReplay = (filename: string) => execute(process.execPath, [
  "--import", "tsx", resolve(import.meta.dirname, "../../analysis/replay-bug-report.ts"), filename
], {
  cwd: resolve(import.meta.dirname, "../../.."), timeout: 240_000, maxBuffer: 2 * 1024 * 1024
});

/** Reuses the strict simulation/scene CLI; never permits a version override or discards the export. */
export const validateExportedRecording = async (
  filename: string, replay: (filename: string) => Promise<{ stdout: string; stderr: string }> = executeReplay
) => {
  const evidence = `${filename}.validation.json`;
  let stdout: string | undefined, stderr: string | undefined, comparison: unknown;
  try {
    const bytes = await readFile(filename);
    assert(bytes.length <= 64 * 1024 * 1024, "Exported recording exceeds 64 MiB");
    const report = JSON.parse(bytes.toString("utf8")) as BugReplayReport;
    assert(isSafeTree(report, SAVE_TREE_DEPTH.bugReplay), "Invalid recording values");
    assert(isCurrentFormat(report, FORMATS.bugReplay), "Unsupported recording format");
    const limit = recordingReplayLimit(report);
    if (limit) throw new MissingPrerequisite(`${limit}; original export retained at ${filename}`);
    const result = await replay(filename);
    stdout = result.stdout;
    stderr = result.stderr;
    const lines = stdout.trim().split("\n");
    const parsed = JSON.parse(lines.at(-1)!);
    comparison = parsed;
    assert(parsed.endpointMatches && parsed.outcomeDifferences === 0,
      "Same-build recording replay diverged; exported report and validation evidence retained");
    await writeFile(evidence, JSON.stringify({ outcome: "pass", stdout, stderr, comparison, filename }, null, 2));
    return { outcome: "pass", evidence, comparison,
      scope: "Strict same-build single-island simulation and scene endpoint" };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    stdout ??= failure.stdout;
    stderr ??= failure.stderr;
    // CLI failures also print their comparison before asserting; retain it if available.
    if (!comparison && stdout) {
      const last = stdout.trim().split("\n").at(-1);
      try { comparison = JSON.parse(last!); } catch { /* Raw process output remains authoritative evidence. */ }
    }
    const outcome = error instanceof MissingPrerequisite ? "blocked" : "fail";
    await writeFile(evidence, JSON.stringify({ outcome, error: String(error), reason: String(error),
      stdout, stderr, comparison, filename }, null, 2));
    throw error;
  }
};
