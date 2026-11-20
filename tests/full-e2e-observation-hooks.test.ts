import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { observeMain, observeSettlementBoot } from "../tools/e2e/full/observation-hooks";

describe("full E2E boot observation boundaries", () => {
  it("instruments the actual split boot owners and rejects missing or ambiguous boundaries", () => {
    const source = (name: string) => readFileSync(new URL(`../src/app/${name}.ts`, import.meta.url), "utf8");
    expect(observeMain(source("island-runtime"))).toContain("window.__fullE2E =");
    expect(observeSettlementBoot(source("island-settlement-boot"))).toContain("window.__fullRestoreResult =");
    expect(() => observeMain(source("island-settlement-boot"))).toThrow("exactly once");
    expect(() => observeSettlementBoot("initialState: restoredGame?.settlement,")).toThrow("exactly once");
    expect(() => observeMain("window.__islandReady = true;window.__islandReady = true;")).toThrow("exactly once");
  });

  it("detaches restore observations before startup proceeds without waiting for hashing", async () => {
    const initial = { buildings: [{ uid: 1 }], roads: [] };
    const restored = structuredClone(initial);
    const window: Record<string, any> = {};
    const calls: string[] = [];
    let finishHash: ((value: unknown) => void) | undefined;
    const fingerprint = new Promise(resolve => { finishHash = resolve; });
    const source = observeSettlementBoot(`
      const input = { initialState: restoredGame?.settlement, };
      options.onCreated(settlement);
    `).replace(/^import[^\n]+\n/, "");
    runInNewContext(source, {
      fullE2EFingerprintWorld: () => { calls.push("fingerprint"); return fingerprint; },
      options: { onCreated: () => { calls.push("created"); initial.buildings[0]!.uid = 2; restored.buildings[0]!.uid = 3; } },
      restoredGame: { settlement: initial },
      settlement: { simulation: { saveState: () => restored } },
      structuredClone, window, world: { seed: 1234, cellsX: 256, cellsZ: 256 }
    });
    expect(calls).toEqual(["fingerprint", "created"]);
    expect(window.__fullRestoreBoundary.buildings[0].uid).toBe(1);
    expect(window.__fullRestoreResult.buildings[0].uid).toBe(1);
    expect(window.__fullWorldRestoreBoundary).toBeUndefined();
    finishHash!({ sha256: "captured" });
    await window.__fullWorldRestorePending;
    expect(window.__fullWorldRestoreBoundary).toEqual({ sha256: "captured" });
  });
});
