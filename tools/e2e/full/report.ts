import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { startTraceWindow } from "./trace";
import { startClip } from "./video";

export type Outcome = "pass" | "fail" | "blocked" | "not-run";
export type CaseResult = {
  id: string; title: string; outcome: Outcome; seconds: number;
  evidence?: unknown; error?: string; screenshot?: string; video?: string; state?: string; trace?: string; failureTrace?: string;
};
export class MissingPrerequisite extends Error {}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const link = (path: string | undefined, title: string) => path ?
  `<a href="${escape(encodeURI(path))}">${title}</a> ` : "";

const failureState = async (page: Page, path: string) => {
  const state = await page.evaluate(() => {
    const sim = (window as any).__settlement?.simulation;
    if (!sim) return { url: location.href, settlement: "not initialized" };
    return { url: location.href, snapshot: sim.snapshot(), status: [...document.querySelectorAll(".settlement-ui__status")]
      .map(node => node.textContent) };
  });
  await writeFile(path, JSON.stringify(state, null, 2));
};

export const createReport = async (directory: string, metadata: Record<string, unknown>) => {
  await mkdir(directory, { recursive: true });
  const cases: CaseResult[] = [], logs: unknown[] = [], assists: unknown[] = [];
  const save = async () => {
    const summary = Object.fromEntries((["pass", "fail", "blocked", "not-run"] as Outcome[])
      .map(outcome => [outcome, cases.filter(item => item.outcome === outcome).length]));
    await writeFile(join(directory, "report.json"), JSON.stringify({ metadata, summary, cases, logs, assists }, null, 2));
    const rows = cases.map(item => `<tr><td>${escape(item.id)}</td><td>${escape(item.title)}</td>` +
      `<td>${escape(item.outcome)}</td><td>${item.seconds.toFixed(1)}</td><td>` +
      link(item.screenshot, "Screenshot") + link(item.video, "Clip") + link(item.state, "State") +
      link(item.trace, "Case prefix trace") + link(item.failureTrace, "Failure trace") +
      `<details><summary>Evidence</summary><pre>${escape(item.error ?? JSON.stringify(item.evidence, null, 2))}</pre>` +
      "</details></td></tr>").join("");
    await writeFile(join(directory, "index.html"), `<!doctype html><meta charset="utf-8"><title>Gameplay acceptance</title>
      <style>body{font:15px system-ui;margin:2rem}td,th{padding:.6rem;border:1px solid #aaa;vertical-align:top}
      table{border-collapse:collapse}pre{white-space:pre-wrap;max-width:65rem}</style>
      <h1>Gameplay acceptance</h1><p>${escape(JSON.stringify(summary))}</p>
      <p>Only individually passed cases have evidence. Blocked and not-run coverage remains outstanding.
      Observation cases do not establish that every production mode or visual detail works.</p>
      <p>Clips use up to eight seconds of real frames at up to 10 fps; startup waits for a real frame.
      Traces retain only the first up to eight seconds and optionally up to three seconds of failure capture,
      with screenshots but no DOM snapshots or sources. Late activity is outside the prefix artifacts.</p>
      <a href="report.json">Report, logs and assists</a> · <a href="coverage.json">Coverage obligations</a>
      <table><tr><th>Case</th><th>Scope</th><th>Outcome</th><th>Seconds</th><th>Evidence</th></tr>${rows}</table>`);
  };
  /** Rows derived without executing an action, such as coverage obligations; executed cases keep precedence. */
  const record = (id: string, title: string, outcome: Outcome, evidence: unknown) => {
    if (cases.some(item => item.id === id)) return;
    cases.push({ id, title, outcome, seconds: 0, evidence });
  };
  const pending = (id: string, title: string, reason: string, outcome: "not-run" | "blocked" = "not-run") =>
    record(id, title, outcome, { reason });
  const runCase = (page: Page, options: { video?: boolean; trace?: boolean; guard?: () => Promise<void> } = {}) =>
    async (id: string, title: string, action: () => Promise<unknown>) => {
      if (cases.some(item => item.id === id)) throw new Error(`Duplicate case ID: ${id}`);
      const started = Date.now(), filename = id.replace(/[^a-zA-Z0-9_-]/g, "-");
      const result: CaseResult = { id, title, outcome: "pass", seconds: 0 };
      let clip: Awaited<ReturnType<typeof startClip>> | undefined;
      let trace: Awaited<ReturnType<typeof startTraceWindow>> | undefined;
      let failureTrace: typeof trace;
      const startTrace = async (traceId: string, seconds = 8) => {
        try { return await startTraceWindow(page.context().tracing, directory, traceId, seconds); }
        catch (error) { logs.push({ kind: "trace-unavailable", id, error: String(error) }); }
      };
      console.log(`START ${id}: ${title}`);
      // Source changes are fatal to the lane, not an ordinary game assertion to catch and continue.
      await options.guard?.();
      if (options.trace) trace = await startTrace(id);
      if (options.video) {
        try { clip = await startClip(page, directory, id); }
        catch (error) { logs.push({ kind: "video-unavailable", id, error: String(error) }); }
      }
      try {
        result.evidence = await action();
        if (result.evidence && typeof result.evidence === "object" && "debugAssist" in result.evidence)
          assists.push({ id, ...(result.evidence as { debugAssist: unknown }) });
      } catch (error) {
        result.outcome = error instanceof MissingPrerequisite ? "blocked" : "fail";
        result.error = error instanceof Error ? error.stack : String(error);
        if (options.trace && !trace?.active) {
          await trace?.stop();
          failureTrace = await startTrace(`${id}-failure`, 3);
        }
        try { await failureState(page, join(directory, `${filename}.state.json`)); result.state = `${filename}.state.json`; }
        catch (failure) { logs.push({ kind: "state-capture-failed", id, error: String(failure) }); }
      }
      if (clip) {
        const evidence = await clip.stop();
        result.video = evidence.filename;
        if (evidence.error) logs.push({ kind: "video-failed", id, ...evidence });
      }
      result.seconds = (Date.now() - started) / 1000;
      try {
        await page.screenshot({ path: join(directory, `${filename}.png`), timeout: 15_000 });
        result.screenshot = `${filename}.png`;
      } catch (error) { logs.push({ kind: "screenshot-failed", id, error: String(error) }); }
      for (const [window, field] of [[trace, "trace"], [failureTrace, "failureTrace"]] as const) {
        if (!window) continue;
        const artifact = await window.stop();
        result[field] = artifact.filename;
        if (artifact.error) logs.push({ kind: "trace-failed", id, window: field, error: artifact.error });
      }
      cases.push(result);
      await save();
      console.log(`${result.outcome.toUpperCase()} ${id} (${result.seconds.toFixed(1)}s)` +
        (result.error ? `: ${result.error.split("\n")[0]}` : ""));
    };
  return { directory, metadata, cases, logs, assists, pending, record, save, runCase };
};
export type FullReport = Awaited<ReturnType<typeof createReport>>;
