import { writeFile } from "node:fs/promises";
import { type Debugger, type Profiler, Session } from "node:inspector";
import { resolve } from "node:path";

/** Opt-in whole-scenario sampling, with slow native ticks aligned for focused tail diagnosis. */
export const startHomeIslandProfile = async (path: string | undefined, landmasses: number) => {
  if (!path) return undefined;
  const session = new Session();
  session.connect();
  const command = (method: "Profiler.enable" | "Profiler.start" | "Profiler.disable" |
    "Debugger.enable" | "Debugger.disable") =>
    new Promise<void>((resolve, reject) => session.post(method, error => error ? reject(error) : resolve()));
  await command("Profiler.enable");
  await command("Profiler.start");
  const started = performance.now();
  const slowTicks: { durationMs: number; elapsedMs: number; tick: number; build: number; terrain: number }[] = [];
  return {
    tick: (tick: number, start: number, durationMs: number, build: number, terrain: number) => {
      if (durationMs >= 100) slowTicks.push({ durationMs, elapsedMs: start - started, tick, build, terrain });
    },
    stop: async () => {
      const profile = await new Promise<Profiler.Profile>((resolve, reject) =>
        session.post("Profiler.stop", (error, result) => error ? reject(error) : resolve(result.profile)));
      await command("Profiler.disable");
      // tsx executes compacted JS; retain its own inline source maps for exact hotspot attribution.
      await command("Debugger.enable");
      const scripts: Record<string, string> = {};
      for (const node of profile.nodes) {
        const { scriptId, url } = node.callFrame;
        if (scripts[scriptId] || !url.includes("/island-of-settlers-client/src/shared/")) continue;
        const source = await new Promise<Debugger.GetScriptSourceReturnType>((resolve, reject) =>
          session.post("Debugger.getScriptSource", { scriptId }, (error, result) =>
            error ? reject(error) : resolve(result)));
        scripts[scriptId] = source.scriptSource;
      }
      await command("Debugger.disable");
      session.disconnect();
      const output = resolve(`${path}.${landmasses}.cpuprofile`);
      await writeFile(output, JSON.stringify(profile));
      await writeFile(`${output}.sources.json`, JSON.stringify(scripts));
      await writeFile(`${output}.ticks.json`, JSON.stringify({ approximateStartTimeUs: profile.startTime,
        note: "Tick windows align to profiler start callback; use for diagnosis, not timing acceptance.",
        slowTicks }, null, 2));
    }
  };
};
