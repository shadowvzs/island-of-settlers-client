import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";

import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;

/** Read-only bounded observer. Runner must disable trace, video, clips and reproduction capture. */
export const runPerformanceCases = async (page: Page, runCase: RunCase, seconds: number) => {
  await runCase("E2E-15-exclusive-soak", `${seconds}s exclusive native-rendered stability observation`, async () => {
    assert(Number.isFinite(seconds) && seconds >= 1 && seconds <= 43_200, "Soak duration must be 1–43200 seconds");
    await page.bringToFront();
    const samples: unknown[] = [];
    const probeId = randomUUID();
    let frames: any;
    try {
      const initial = await page.evaluate(() => {
        const live = (window as any).__settlement;
        const sim = live?.simulation;
        if (!sim || sim.buildings().length < 4) return { ready: false, reason: "Need at least four active buildings" };
        if (document.hidden || document.visibilityState !== "visible") return { ready: false, reason: "Page is hidden" };
        if (live.bugReplay?.recording()) return { ready: false, reason: "Reproduction recording is active" };
        const canvas = document.querySelector<HTMLCanvasElement>("#view");
        const bounds = canvas?.getBoundingClientRect();
        if (!canvas || !canvas.width || !canvas.height || !bounds?.width || !bounds.height)
          return { ready: false, reason: "Game canvas has no visible rendered surface" };
        const gl = canvas.getContext("webgl2");
        if (!gl || gl.isContextLost()) return { ready: false, reason: "Active WebGL2 context is unavailable/lost" };
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "";
        return { ready: true, renderer, actors: sim.frames().length, buildings: sim.buildings().length,
          canvas: { width: canvas!.width, height: canvas!.height }, visibility: document.visibilityState };
      });
      if (!initial.ready) throw new MissingPrerequisite(`Performance baseline: ${initial.reason}`);
      if (!initial.renderer || /unavailable|unknown|^webkit|^webgl|^null$/i.test(initial.renderer))
        throw new MissingPrerequisite("Unmasked GPU identity is unavailable; native hardware performance cannot be established");
      assert(!/swiftshader|llvmpipe|softpipe|software rasterizer|lavapipe/i.test(initial.renderer),
        "Software GPU cannot establish native GPU performance");
      await page.waitForTimeout(1500);
      await page.evaluate((owner) => {
        const prior = (window as any).__fullFrameProbe;
        if (prior) throw new Error("Another frame probe is active; exclusive baseline is required");
        const state = { owner, histogram: Array<number>(502).fill(0), count: 0, hiddenFrames: 0,
          visibilityChanges: 0, hiddenObserved: document.hidden, maximum: 0, last: performance.now(),
          started: performance.now(), ended: 0, active: true, raf: 0, onVisibility: () => {} };
        state.onVisibility = () => { state.visibilityChanges++; state.hiddenObserved ||= document.hidden; };
        document.addEventListener("visibilitychange", state.onVisibility);
        const sample = (now: number) => {
          if (!state.active) return;
          const delta = Math.max(0, now - state.last); state.last = now;
          if (document.hidden) { state.hiddenFrames++; state.hiddenObserved = true; }
          else {
            state.count++; state.maximum = Math.max(state.maximum, delta);
            const index = Math.min(501, Math.floor(delta));
            state.histogram[index] = (state.histogram[index] ?? 0) + 1;
          }
          state.raf = requestAnimationFrame(sample);
        };
        (window as any).__fullFrameProbe = state;
        state.raf = requestAnimationFrame(sample);
      }, probeId);
      const end = Date.now() + seconds * 1000;
      while (Date.now() < end) {
        const sample = await page.evaluate(() => {
          const live = (window as any).__settlement, sim = live.simulation;
          const actors = sim.frames(), buildings = sim.buildings();
          return { at: performance.now(), visible: !document.hidden,
            recording: live.bugReplay?.recording() ?? false,
            contextLost: document.querySelector<HTMLCanvasElement>("#view")?.getContext("webgl2")?.isContextLost() ?? true,
            memory: (performance as any).memory?.usedJSHeapSize ?? null,
            actors: actors.length, buildings: buildings.length,
            invalidActors: actors.filter((actor: any) => !Number.isFinite(actor.x) || !Number.isFinite(actor.z))
              .map((actor: any) => actor.uid),
            negativeStocks: buildings.flatMap((building: any) => Object.entries(building.inventory)
              .filter(([, amount]) => !Number.isFinite(amount) || Number(amount) < 0)
              .map(([ware, amount]) => ({ uid: building.uid, ware, amount }))) };
        });
        assert.equal(sample.invalidActors.length, 0, `Nonfinite actor positions: ${JSON.stringify(sample)}`);
        assert.equal(sample.negativeStocks.length, 0, `Invalid inventory: ${JSON.stringify(sample)}`);
        assert(sample.visible, "Hidden-tab throttling invalidates exclusive performance results");
        assert(!sample.recording && !sample.contextLost, "Recording/context loss invalidates the native baseline");
        samples.push(sample);
        if (samples.length > 300) samples.shift();
        await page.waitForTimeout(Math.min(2000, Math.max(1, end - Date.now())));
      }
      frames = await page.evaluate(() => {
        const state = (window as any).__fullFrameProbe;
        return { histogram: [...state.histogram], count: state.count, hiddenFrames: state.hiddenFrames,
          hiddenObserved: state.hiddenObserved, visibilityChanges: state.visibilityChanges, maximum: state.maximum,
          elapsedMs: performance.now() - state.started };
      });
      assert(frames.count > 0, "No rendered frames recorded");
      assert(!frames.hiddenObserved && frames.hiddenFrames === 0, "Transient background throttling observed");
      const percentile = (fraction: number) => {
        let count = 0;
        for (let index = 0; index < frames.histogram.length; index++) {
          count += frames.histogram[index];
          if (count >= frames.count * fraction) return index === 501 ? ">=501" : index + 1;
        }
        return null;
      };
      return { initial, samples, frames, p50MsUpper: percentile(.5), p95MsUpper: percentile(.95),
        p99MsUpper: percentile(.99), sampling: "Bounded RAF histogram; read-only actor/inventory inspection every two seconds",
        scope: "Coordinator disables trace/video/clips/reproduction. Exclusive foreground-page frame intervals, " +
          "not GPU execution times or independently measured input latency. Heap samples and observer overhead are retained; " +
          "route/queue CPU timing, throughput and multi-voyage coverage require separate journey cases." };
    } finally {
      if (!page.isClosed()) await page.evaluate((owner) => {
        const state = (window as any).__fullFrameProbe;
        if (!state || state.owner !== owner) return;
        state.active = false; cancelAnimationFrame(state.raf);
        document.removeEventListener("visibilitychange", state.onVisibility);
        delete (window as any).__fullFrameProbe;
      }, probeId);
    }
  });
};
