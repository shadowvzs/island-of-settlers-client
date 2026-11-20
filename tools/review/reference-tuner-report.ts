import { type AnalysedSubject, type MetricValue } from "./reference-tuner-analysis";

/** Markdown metrics table of a tuner run (TOOL-8): one row per metric, one column per subject. */

interface ReportResult {
  game: AnalysedSubject[];
  references: AnalysedSubject[];
}

const cell = (value: MetricValue | undefined) => {
  if (value === undefined || value === null) return "–";
  return Array.isArray(value) ? value.map(channel => channel ?? "–").join("/") : String(value);
};

export const metricsTable = (result: ReportResult, before: ReportResult | null) => {
  const columns = [
    ...result.references.map(subject => ({ heading: `ref ${subject.label}`, metrics: subject.metrics })),
    ...(before?.game ?? []).map(subject => ({ heading: `before ${subject.label}`, metrics: subject.metrics })),
    ...result.game.map(subject => ({ heading: `game ${subject.label}`, metrics: subject.metrics }))
  ];
  const keys = [...new Set(columns.flatMap(column => Object.keys(column.metrics)))].sort();
  const lines = [`| metric | ${columns.map(column => column.heading).join(" | ")} |`,
    `| --- |${columns.map(() => " --- |").join("")}`,
    ...keys.map(key => `| ${key} | ${columns.map(column => cell(column.metrics[key])).join(" | ")} |`)];
  return `${lines.join("\n")}\n`;
};
