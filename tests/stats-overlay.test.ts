import { createElement } from "react";
import { renderWithI18n } from "./helpers/render-with-i18n";
import { expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { formatStatsText } from "../src/app/stats-overlay/helpers";
import { StatsOverlayBody } from "../src/app/stats-overlay/stats-overlay-body";

it("renders the info panel copy in Hungarian", () => {
  const text = createExternalStore({ help: "súgó", stats: "fps: 60" });
  const markup = renderWithI18n(createElement(StatsOverlayBody, { text }), "hu");
  expect(markup).toContain('aria-label="Infó másolása a vágólapra"');
});

it("puts a copy-to-clipboard action in the info panel", () => {
  const text = createExternalStore({ help: "help", stats: "draw calls: 2" });
  const markup = renderWithI18n(createElement(StatsOverlayBody, { text }));
  expect(markup).toContain('aria-label="Copy info to clipboard"');
  expect(markup).toContain('class="stats-overlay__copy"');
  expect(markup).toContain("stats-overlay__copy-icon");
  expect(markup).toContain("draw calls: 2");
});

it("distinguishes missing GPU timer samples from measured zero GPU work", () => {
  const summary = {
    averageFps: 17, cpuMs: 10.26, drawCalls: 478, frameMsP95: 60,
    gpuMs: 0, gpuMsP95: 0, lowFps: 9, triangles: 1176500
  };
  expect(formatStatsText([], "high", summary, { details: {} })).toContain("gpu: not measured, cpu: 10.26 ms");
  expect(formatStatsText([], "high", { ...summary, gpuMs: 6.17, gpuMsP95: 7.12 }, { details: {} }))
    .toContain("gpu: 6.17 ms (p95 7.12)");
});
