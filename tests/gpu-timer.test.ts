import { describe, expect, it } from "vitest";

import { createGpuTimer } from "../src/render-common/gpu-timer";

/** A WebGL2 stub with the timer extension that records query calls. */
const fakeGl = () => {
  const canvas = new EventTarget();
  const calls: string[] = [];
  const gl = {
    canvas,
    QUERY_RESULT: 1, QUERY_RESULT_AVAILABLE: 2,
    beginQuery: () => calls.push("begin"),
    createQuery: () => ({}),
    endQuery: () => calls.push("end"),
    getExtension: () => ({}),
    getParameter: () => false,
    getQueryParameter: (_query: unknown, parameter: number) => parameter === 2 ? true : 2e6
  };
  return { calls, canvas, gl: gl as unknown as WebGL2RenderingContext };
};

describe("GPU frame timer", () => {
  it("stops querying while the context is lost and resumes after restore", () => {
    const { calls, canvas, gl } = fakeGl();
    const timer = createGpuTimer(gl)!;
    const results: number[] = [];
    timer.begin(); timer.end(); timer.poll(ms => results.push(ms));
    canvas.dispatchEvent(new Event("webglcontextlost"));
    timer.begin(); timer.end(); timer.poll(ms => results.push(ms));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    timer.begin(); timer.end(); timer.poll(ms => results.push(ms));
    expect(calls).toEqual(["begin", "end", "begin", "end"]);
    expect(results).toEqual([2, 2]);
  });

  it("ends only a query it began", () => {
    const { calls, gl } = fakeGl();
    const timer = createGpuTimer(gl)!;
    timer.end();
    expect(calls).toEqual([]);
  });
});
