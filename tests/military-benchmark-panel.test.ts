import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  BENCHMARK_COLUMNS,
  getBenchmarkToolTitle,
  getBenchmarkView
} from "../src/app/settlement/military-benchmark/helpers";
import { MilitaryBenchmarkPanel } from "../src/app/settlement/military-benchmark/military-benchmark-panel";
import benchmark from "../src/app/settlement/military-mode-benchmark.json";

// The mount helper reads the browser language store; markup checks need only the view.
vi.mock("../src/app/components/react-island", () => ({ mountReactIsland: vi.fn() }));

const render = () => renderToStaticMarkup(createElement(MilitaryBenchmarkPanel, getBenchmarkView(benchmark)));

describe("historical military benchmark markup", () => {
  it("states the archive and renders the caption and column headers", () => {
    const markup = render();
    expect(markup).toMatch(new RegExp(`^<p>Historical build measurements dated ${benchmark.measured}\\.`));
    expect(markup).toContain('role="region" tabindex="0"');
    expect(markup).toContain(
      `<caption>Historical military mode benchmark · ${benchmark.measured} · archive 1593ad6</caption>`);
    for (const column of BENCHMARK_COLUMNS) expect(markup).toContain(`<th scope="col">${column}</th>`);
    expect(getBenchmarkToolTitle(benchmark.measured))
      .toBe(`Archived ${benchmark.measured} results from 1593ad6; not current measurements`);
  });

  it("renders every archived row, whatever modes the archive lists", () => {
    const markup = render();
    expect(markup.match(/<tr><td>/g)).toHaveLength(benchmark.rows.length);
    expect(markup).toContain("<td>1 · Individual paths</td><td>crossing 24x24</td><td>0.29 / 0.63 / 5.14</td>");
    const view = getBenchmarkView({
      measured: "2026-01-01",
      rows: [{ collisions: 1, losses: "1:0", mode: "flowCommander", outcomeSeconds: null, pathRatio: 1.1,
        scenario: "siege door", stuckSeconds: 0, tick: "1 / 2 / 3" },
      { collisions: 1, losses: "1:0", mode: "futureMode", pathRatio: 1, scenario: "x", stuckSeconds: 0, tick: "1" }]
    });
    expect(view.rows.map(row => row.cells[0])).toEqual(["5 · Flow fields + commander", "futureMode"]);
    expect(view.rows[0]!.cells[6]).toBe("—");
  });
});
