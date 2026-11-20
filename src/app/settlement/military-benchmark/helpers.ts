const ARCHIVE_COMMIT = "1593ad6";

/** Mode names as the archive numbered them; unknown modes show their raw id. */
const MODE_LABELS: Readonly<Record<string, string>> = {
  current: "1 · Individual paths", flowFields: "2 · Flow fields", formations: "3 · Formations",
  smartCommander: "4 · Smart commander", flowCommander: "5 · Flow fields + commander"
};

export const BENCHMARK_COLUMNS = ["Historical mode", "Scenario", "Tick p50 / p95 / max (ms)", "Contacts / s",
  "Stuck (s)", "Path ratio", "Win / arrival (s)", "Losses"] as const;

interface BenchmarkRow {
  collisions: number;
  losses: string;
  mode: string;
  outcomeSeconds?: number | null;
  pathRatio: number;
  scenario: string;
  stuckSeconds: number;
  tick: string;
}

export interface BenchmarkRowView {
  cells: readonly string[];
  key: string;
}

export interface BenchmarkArchive {
  measured: string;
  rows: readonly BenchmarkRow[];
}

/** Tooltip of the development tool that opens the window. */
export const getBenchmarkToolTitle = (measured: string) =>
  `Archived ${measured} results from ${ARCHIVE_COMMIT}; not current measurements`;

const toRowView = (row: BenchmarkRow): BenchmarkRowView => ({
  cells: [MODE_LABELS[row.mode] ?? row.mode, row.scenario, row.tick, row.collisions, row.stuckSeconds,
    row.pathRatio, row.outcomeSeconds ?? "—", row.losses].map(String),
  key: `${row.mode}/${row.scenario}`
});

/** Notice, caption and every archived row, in archive order. */
export const getBenchmarkView = ({ measured, rows }: BenchmarkArchive) => ({
  caption: `Historical military mode benchmark · ${measured} · archive ${ARCHIVE_COMMIT}`,
  columns: BENCHMARK_COLUMNS,
  notice: `Historical build measurements dated ${measured}. ` +
    `Recovered unchanged from source snapshot ${ARCHIVE_COMMIT}; the original measurement commit was not recorded. ` +
    "These are archived comparisons, not measurements of the current game. No AI mode changes when this window opens.",
  rows: rows.map(toRowView)
});
