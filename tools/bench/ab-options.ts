import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { type ExtractorSpec, parseExtractor } from "./ab-extract";

/**
 * Options of the A/B perf runner (TOOL-4): command line flags, optionally on top of a JSON preset (`--config`).
 * Flags win over the preset; list flags (`--env`, `--metric`, `--hash`) are appended to the preset's lists.
 */

export interface AbOptions {
  base: string;
  browserSlot: boolean;
  command: string[];
  env: Record<string, string>;
  hashes: ExtractorSpec[];
  keepWorktree: boolean;
  lane: string;
  metrics: ExtractorSpec[];
  nice: number;
  order: "abab" | "abba";
  out: string | undefined;
  rounds: number;
  timeoutSeconds: number;
  warmup: number;
  worktreeRoot: string | undefined;
}

interface AbPreset {
  base?: string;
  command?: string[];
  env?: Record<string, string>;
  hashes?: string[];
  metrics?: string[];
  nice?: number;
  order?: "abab" | "abba";
  rounds?: number;
  timeoutSeconds?: number;
  warmup?: number;
}

export const USAGE = `Usage: npx tsx tools/bench/ab-runner.ts --base <git ref | worktree path> [options] \\
    -- <bench> [args]
  --lane <path>          lane checkout (default: this worktree)
  --config <file.json>   preset with base, command, env, metrics, hashes, rounds, warmup, nice, order
  --rounds <n>           measured rounds, each runs base and lane once (default 5)
  --warmup <n>           discarded runs per side before the rounds (default 1)
  --nice <n>             nice level of every run (default 15)
  --order abba|abab      run order inside the rounds (default abba)
  --env KEY=VALUE        environment of both sides (repeatable)
  --metric name=/re/     numeric metric: /regex/flags (group "value" or 1) or json:path (repeatable)
  --hash name=/re/       text that must be equal on every run, e.g. a state hash (repeatable)
  --out <dir>            write ab-result.json, ab-result.md and the run logs there
  --timeout <seconds>    per run (default 900)
  --browser-slot         wrap each run in captures/browser-slot.sh (browser benches)
  --keep-worktree        keep the temporary base worktree
  --worktree-root <dir>  parent of the temporary base worktree (default: the large drive worktree folder)
A bench ending in .ts/.mts runs as \`npx tsx <bench>\` from island-of-settlers-client of each side.`;

const readPreset = (path: string | undefined): AbPreset =>
  path ? JSON.parse(readFileSync(resolve(path), "utf8")) as AbPreset : {};

const envPairs = (pairs: readonly string[]) => Object.fromEntries(pairs.map(pair => {
  const separator = pair.indexOf("=");
  if (separator <= 0) throw new Error(`--env needs KEY=VALUE, got "${pair}"`);
  return [pair.slice(0, separator), pair.slice(separator + 1)];
}));

const integer = (text: string | undefined, fallback: number, name: string) => {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} needs a whole number, got "${text}"`);
  return value;
};

const ARGUMENTS = {
  base: { type: "string" },
  "browser-slot": { type: "boolean" },
  config: { type: "string" },
  env: { multiple: true, type: "string" },
  hash: { multiple: true, type: "string" },
  help: { type: "boolean" },
  "keep-worktree": { type: "boolean" },
  lane: { type: "string" },
  metric: { multiple: true, type: "string" },
  nice: { type: "string" },
  order: { type: "string" },
  out: { type: "string" },
  rounds: { type: "string" },
  timeout: { type: "string" },
  warmup: { type: "string" },
  "worktree-root": { type: "string" }
} as const;

const orderOf = (text: string | undefined) => {
  if (text === "abab" || text === "abba") return text;
  throw new Error(`--order must be abab or abba, got "${text}"`);
};

export const parseOptions = (argv: readonly string[]): AbOptions | null => {
  const { positionals, values } = parseArgs({ args: [...argv], allowPositionals: true, options: ARGUMENTS });
  if (values.help) return null;
  const preset = readPreset(values.config);
  const base = values.base ?? preset.base;
  const command = positionals.length ? positionals : preset.command ?? [];
  if (!base || !command.length) throw new Error(`--base and a bench command are required\n${USAGE}`);
  return {
    base,
    browserSlot: values["browser-slot"] ?? false,
    command,
    env: { ...preset.env, ...envPairs(values.env ?? []) },
    hashes: [...preset.hashes ?? [], ...values.hash ?? []].map(parseExtractor),
    keepWorktree: values["keep-worktree"] ?? false,
    lane: resolve(values.lane ?? "."),
    metrics: [...preset.metrics ?? [], ...values.metric ?? []].map(parseExtractor),
    nice: integer(values.nice, preset.nice ?? 15, "nice"),
    order: orderOf(values.order ?? preset.order ?? "abba"),
    out: values.out,
    rounds: Math.max(1, integer(values.rounds, preset.rounds ?? 5, "rounds")),
    timeoutSeconds: integer(values.timeout, preset.timeoutSeconds ?? 900, "timeout"),
    warmup: integer(values.warmup, preset.warmup ?? 1, "warmup"),
    worktreeRoot: values["worktree-root"]
  };
};
