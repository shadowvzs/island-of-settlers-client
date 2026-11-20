import { describe, expect, it } from "vitest";

import { benchJsonOf, extractRun, parseExtractor, valueAtPath } from "../tools/bench/ab-extract";
import { compareRuns, formatNumber, markdownReport, type RunRecord } from "../tools/bench/ab-report";
import {
  checkDeterminism,
  compareSamples,
  median,
  medianAbsoluteDeviation,
  pairedDifferences,
  quantileOfSorted,
  runOrder,
  summarize
} from "../tools/bench/ab-stats";

describe("A/B runner statistics", () => {
  it("computes median, quantiles, MAD and IQR robustly", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantileOfSorted([0, 10], .25)).toBe(2.5);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1);
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ count: 5, iqr: 2, mad: 1, max: 5, median: 3, min: 1 });
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("flags identical noisy samples as within noise", () => {
    const comparison = compareSamples([10, 11, 9, 10.5, 9.5], [9.8, 10.6, 9.2, 10.4, 10.1]);
    expect(comparison.withinNoise).toBe(true);
    expect(comparison.rangesOverlap).toBe(true);
  });

  it("flags a clear shift as a change with its percentage", () => {
    const comparison = compareSamples([10, 10.2, 9.9, 10.1, 10], [8, 8.1, 7.9, 8.05, 8]);
    expect(comparison.withinNoise).toBe(false);
    expect(comparison.delta).toBeCloseTo(-2);
    expect(comparison.deltaPercent).toBeCloseTo(-20);
    expect(comparison.rangesOverlap).toBe(false);
  });

  it("treats deterministic counts exactly and keeps a zero base percentage undefined", () => {
    expect(compareSamples([4, 4, 4], [4, 4, 4]).withinNoise).toBe(true);
    expect(compareSamples([4, 4, 4], [5, 5, 5]).withinNoise).toBe(false);
    expect(compareSamples([0, 0], [1, 1]).deltaPercent).toBeNull();
  });

  it("pairs rounds by index and reports the paired band from three rounds", () => {
    expect(pairedDifferences([1, 2, 3], [2, 4])).toEqual([1, 2]);
    expect(compareSamples([1, 2], [2, 3]).pairedBand).toBeNull();
    const drifting = compareSamples([10, 20, 30, 40], [11, 21, 31, 41]);
    expect(drifting.pairedDelta).toBe(1);
    expect(drifting.pairedBand).toBe(0);
  });

  it("checks determinism per side and across sides", () => {
    expect(checkDeterminism(["a", "a"], ["a", "a"])).toMatchObject({ allEqual: true, stablePerSide: true });
    expect(checkDeterminism(["a", "a"], ["b", "b"])).toMatchObject({ allEqual: false, stablePerSide: true });
    expect(checkDeterminism(["a", "c"], ["a", "a"])).toMatchObject({ allEqual: false, stablePerSide: false });
  });

  it("orders runs ABBA or alternating", () => {
    expect(runOrder(3, "abba")).toEqual(["base", "lane", "lane", "base", "base", "lane"]);
    expect(runOrder(2, "abab")).toEqual(["base", "lane", "base", "lane"]);
  });
});

describe("A/B runner extraction", () => {
  const output = [
    "| flat | 64 vs 64 | 1.23 | 2.50 |",
    "  flat: commander ms avg/tick 0.0134, decision p50 0.162; save hash a95a1def2fe51e08",
    "BENCH_JSON {\"flat\":{\"battle\":{\"avg\":1.5},\"hash\":\"abc\"}}",
    "BENCH_JSON {\"coastal\":{\"battle\":{\"avg\":1.1}},\"list\":[7,8]}",
    "BENCH_JSON {broken"
  ].join("\n");

  it("parses regex and JSON path specs", () => {
    expect(parseExtractor("avg=/avg\\/tick ([\\d.]+)/").source.kind).toBe("regex");
    expect(parseExtractor("avg=json:flat.battle.avg").source).toEqual({ kind: "json", path: "flat.battle.avg" });
    expect(() => parseExtractor("avg")).toThrow();
    expect(() => parseExtractor("avg=plain")).toThrow();
  });

  it("merges BENCH_JSON lines and reads paths with array indices", () => {
    const json = benchJsonOf(output);
    expect(valueAtPath(json, "coastal.battle.avg")).toBe(1.1);
    expect(valueAtPath(json, "list.1")).toBe(8);
    expect(valueAtPath(json, "flat.missing.deep")).toBeUndefined();
  });

  it("extracts numbers, hashes and missing values from one run", () => {
    const run = extractRun(output, [
      parseExtractor("commander=/commander ms avg\\/tick (?<value>[\\d.]+)/"),
      parseExtractor("battle=json:flat.battle.avg"),
      parseExtractor("absent=/nothing (\\d+)/")
    ], [parseExtractor("hash=/save hash (\\w+)/"), parseExtractor("jsonHash=json:flat.hash")]);
    expect(run.numbers).toEqual({ battle: 1.5, commander: .0134 });
    expect(run.hashes).toEqual({ hash: "a95a1def2fe51e08", jsonHash: "abc" });
    expect(run.missing).toEqual(["absent"]);
  });

  it("reads keys that contain dots with brackets or escaped dots", () => {
    const dotted = [
      output,
      "BENCH_JSON {\"high.s1.webgpu\":{\"cpuMedian\":4.2},\"a.b\":1,\"odd key[0]\":{\"v\":3}}"
    ].join("\n");
    const json = benchJsonOf(dotted);
    expect(valueAtPath(json, "high\\.s1\\.webgpu.cpuMedian")).toBe(4.2);
    expect(valueAtPath(json, "[\"high.s1.webgpu\"].cpuMedian")).toBe(4.2);
    expect(valueAtPath(json, "['high.s1.webgpu'].cpuMedian")).toBe(4.2);
    expect(valueAtPath(json, "a\\.b")).toBe(1);
    expect(valueAtPath(json, "[\"a.b\"]")).toBe(1);
    expect(valueAtPath(json, "[\"odd key[0]\"].v")).toBe(3);
    expect(valueAtPath(json, "list[1]")).toBe(8);
    expect(() => valueAtPath(json, "[\"unclosed\"")).toThrow();
  });

  it("extracts a dotted BENCH_JSON key end to end", () => {
    const dotted = [output, "BENCH_JSON {\"high.s1.webgpu\":{\"cpuMedian\":4.2}}"].join("\n");
    const run = extractRun(dotted, [
      parseExtractor("cpu=json:high\\.s1\\.webgpu.cpuMedian"),
      parseExtractor("cpuBracket=json:[\"high.s1.webgpu\"].cpuMedian")
    ], []);
    expect(run.numbers).toEqual({ cpu: 4.2, cpuBracket: 4.2 });
    expect(run.missing).toEqual([]);
  });
});

describe("A/B runner report", () => {
  const run = (side: "base" | "lane", round: number, tick: number, exitCode = 0): RunRecord =>
    ({ exitCode, hashes: { hash: "h1" }, missing: [], numbers: { tick }, round, side, wallSeconds: 1 });

  it("compares successful runs only and renders the markdown tables", () => {
    const runs = [run("base", 0, 1), run("lane", 0, 1.01), run("base", 1, 1.02), run("lane", 1, .99),
      run("base", 2, .98), run("lane", 2, 1), run("lane", 3, 50, 1)];
    const { determinism, metrics } = compareRuns(runs, ["tick"], ["hash"]);
    expect(metrics.tick?.lane.max).toBe(1.01);
    expect(determinism.hash?.allEqual).toBe(true);
    const markdown = markdownReport({
      base: { commit: "0123456789", label: "master", root: "/b" }, command: ["bench.ts"], createdAt: "now",
      determinism, env: { PHASES: "1" }, failedRuns: 1, lane: { commit: "abcdef0123", label: "lane", root: "/l" },
      metrics, nice: 15, order: "abba", rounds: 3, runs, warmup: 1
    });
    expect(markdown).toContain("| tick | 1.00 (0.980–1.02) | 1.00 (0.990–1.01) |");
    expect(markdown).toContain("within noise");
    expect(markdown).toContain("| hash | h1 | h1 | equal |");
  });

  it("formats numbers to three significant digits", () => {
    expect(formatNumber(1234.5)).toBe("1235");
    expect(formatNumber(.013456)).toBe("0.0135");
    expect(formatNumber(null)).toBe("–");
  });
});
