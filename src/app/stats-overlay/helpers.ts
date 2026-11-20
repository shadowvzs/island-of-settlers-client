import type { I18n } from "@lingui/core";

import type { FrameSummary } from "../../render-common/frame-stats";
import type { QualityLevel } from "../../render-common/quality";
import type { RendererStats } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import { STATS_MESSAGES as M } from "./messages";

/** What the info panel body shows: the frame statistics and the controls help. */
export interface StatsOverlayText {
  help: string;
  stats: string;
}

export const DEFAULT_STATS_HELP =
  "drag / arrow keys: pan, wheel: zoom, click a tree: fell it\n" +
  "left-click worker: select, right-click ground: move, left-click elsewhere: deselect, " +
  "C: cinematic camera";

export const SOFTWARE_GL_WARNING = "WARNING: software WebGL (no GPU), timings are not valid";

export const getDefaultStatsHelp = (i18n?: I18n) => translateMessage(i18n, M.help.default);

export const getSoftwareGlWarning = (i18n?: I18n) => translateMessage(i18n, M.warning.software);

const formatNumber = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 1 : 0);

const formatDetail = (value: number | string) => (typeof value === "number" ? formatNumber(value) : value);

/** The statistics text: warnings, detail level, frame rate, GPU / CPU time, draw calls and renderer details. */
export const formatStatsText = (
  warnings: readonly string[], detail: QualityLevel, summary: FrameSummary, stats: RendererStats, i18n?: I18n
) => {
  const label = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const details = Object.entries(stats.details).map(([key, value]) => `${key}: ${formatDetail(value)}`).join("\n");
  const gpu = summary.gpuMs > 0
    ? `${label(M.label.gpu)}: ${summary.gpuMs.toFixed(2)} ms (p95 ${summary.gpuMsP95.toFixed(2)})`
    : `${label(M.label.gpu)}: ${label(M.label.notMeasured)}`;
  return [
    ...warnings,
    `${label(M.label.detail)}: ${detail}`,
    `${label(M.label.fps)}: ${summary.averageFps.toFixed(0)} (${label(M.label.low)} ${summary.lowFps.toFixed(0)})`,
    `${gpu}, ${label(M.label.cpu)}: ${summary.cpuMs.toFixed(2)} ms`,
    `${label(M.label.drawCalls)}: ${summary.drawCalls}, ${label(M.label.triangles)}: ${formatNumber(summary.triangles)}`,
    details
  ].join("\n");
};
