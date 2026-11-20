import {
  checkDeterminism,
  compareSamples,
  type DeterminismCheck,
  type MetricComparison,
  type RunSide
} from "./ab-stats";

/**
 * Result model and markdown table of the A/B perf runner (TOOL-4). Pure: builds the comparison from the per-run
 * extracted values and formats a table ready to paste into a lane receipt.
 */

export interface RunRecord {
  exitCode: number | null;
  hashes: Record<string, string>;
  missing: string[];
  numbers: Record<string, number>;
  round: number;
  side: RunSide;
  wallSeconds: number;
}

export interface SideInfo {
  commit: string;
  label: string;
  root: string;
}

export interface AbResult {
  base: SideInfo;
  command: string[];
  createdAt: string;
  determinism: Record<string, DeterminismCheck>;
  env: Record<string, string>;
  failedRuns: number;
  lane: SideInfo;
  metrics: Record<string, MetricComparison>;
  nice: number;
  order: string;
  rounds: number;
  runs: RunRecord[];
  warmup: number;
}

const valuesOf = <T>(runs: readonly RunRecord[], side: RunSide, read: (run: RunRecord) => T | undefined) =>
  runs.filter(run => run.side === side).map(read).filter((value): value is T => value !== undefined);

export const compareRuns = (
  runs: readonly RunRecord[],
  metricNames: readonly string[],
  hashNames: readonly string[]
) => {
  const ok = runs.filter(run => run.exitCode === 0);
  const metrics: Record<string, MetricComparison> = {};
  for (const name of metricNames) {
    const base = valuesOf(ok, "base", run => run.numbers[name]);
    const lane = valuesOf(ok, "lane", run => run.numbers[name]);
    if (base.length && lane.length) metrics[name] = compareSamples(base, lane);
  }
  const determinism: Record<string, DeterminismCheck> = {};
  for (const name of hashNames)
    determinism[name] = checkDeterminism(valuesOf(ok, "base", run => run.hashes[name]),
      valuesOf(ok, "lane", run => run.hashes[name]));
  return { determinism, metrics };
};

/** Short number for tables: 3 significant digits, at least the integer part. */
export const formatNumber = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value))));
  return value.toFixed(Math.min(digits, 6));
};

const signed = (value: number | null, suffix = "") => {
  if (value === null || !Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}${suffix}`;
};

export const verdictOf = (comparison: MetricComparison) => {
  if (comparison.withinNoise) return "within noise";
  return comparison.delta < 0 ? "**lower**" : "**higher**";
};

const sampleCell = ({ max, median, min }: MetricComparison["base"]) =>
  `${formatNumber(median)} (${formatNumber(min)}–${formatNumber(max)})`;

const pairedCell = ({ pairedBand, pairedDelta }: MetricComparison) =>
  pairedBand === null ? signed(pairedDelta) : `${signed(pairedDelta)} ±${formatNumber(pairedBand)}`;

const metricRow = (name: string, comparison: MetricComparison) => `| ${name} | ${sampleCell(comparison.base)} | ` +
  `${sampleCell(comparison.lane)} | ${signed(comparison.delta)} | ${signed(comparison.deltaPercent, " %")} | ` +
  `±${formatNumber(comparison.noiseBand)} | ${pairedCell(comparison)} | ${verdictOf(comparison)} |`;

const determinismVerdict = (check: DeterminismCheck) => {
  if (!check.stablePerSide) return "**unstable**";
  return check.allEqual ? "equal" : "**differs**";
};

const determinismRow = (name: string, check: DeterminismCheck) => `| ${name} | ${check.baseValues.join(", ")} | ` +
  `${check.laneValues.join(", ")} | ${determinismVerdict(check)} |`;

const headerLines = (result: AbResult) => {
  const env = Object.entries(result.env).map(([key, value]) => `${key}=${value}`).join(" ");
  return [
    `A/B \`${result.command.join(" ")}\`${env ? ` with \`${env}\`` : ""}: base ${result.base.label} ` +
      `(\`${result.base.commit.slice(0, 9)}\`) vs lane ${result.lane.label} (\`${result.lane.commit.slice(0, 9)}\`), ` +
      `${result.rounds} rounds ${result.order.toUpperCase()}, ${result.warmup} warm-up per side, ` +
      `\`nice -n ${result.nice}\`, ${result.failedRuns} failed runs (${result.createdAt}).`,
    ""
  ];
};

export const markdownReport = (result: AbResult) => {
  const lines = headerLines(result);
  lines.push("| Metric | Base median (min–max) | Lane median (min–max) | Δ | Δ % | Noise band | Paired Δ " +
    "| Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, comparison] of Object.entries(result.metrics)) lines.push(metricRow(name, comparison));
  const hashes = Object.entries(result.determinism);
  if (hashes.length) {
    lines.push("", "| Determinism | Base | Lane | Result |", "| --- | --- | --- | --- |");
    for (const [name, check] of hashes) lines.push(determinismRow(name, check));
  }
  lines.push("", "Noise band = 2 x 1.4826 x pooled MAD of the two sides (about 95 %); paired Δ = median of the " +
    "per-round lane − base differences ± the same band over those differences.");
  return `${lines.join("\n")}\n`;
};
