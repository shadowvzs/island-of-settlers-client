import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Verify browser-worker scale receipts without rerunning the replay:
 *   npx tsx tools/acceptance/offline-scale-verify.ts \
 *     ../resources/offline-economy/final-acceptance-2026-10-27/browser-24h-owner.json \
 *     ../resources/offline-economy/final-acceptance-2026-10-27/browser-24h-five-coupled.json
 *
 * Checks the fixture bytes against the recorded SHA-256, reconstruction validity, every cursor,
 * the module-worker URL, the 30 s catch-up+reconstruction budget and the separate 60 s exact resume.
 * It does not establish UI/GPU/startup latency or production accuracy.
 */
interface Receipt {
  catchUpWallMs?: number;
  copies?: number;
  exactResume?: { cursorCorrect?: boolean; wallMs?: number };
  finalStageWallMs?: number;
  fixture?: { path?: string; sha256?: string; bytes?: number; archipelagoStripped?: boolean };
  horizonSeconds?: number;
  host?: { start?: { loadAverage?: number[] }; end?: { loadAverage?: number[] } };
  reconstruction?: { valid?: boolean; actors?: number; buildings?: number };
  runs?: { cursorCorrect?: boolean }[];
  totalCatchUpAndStageMs?: number;
  totalEconomyEvents?: number;
  within30Seconds?: boolean;
  workerUrls?: string[];
}
const verify = async (path: string) => {
  const bytes = await readFile(path);
  const receipt = JSON.parse(bytes.toString("utf8")) as Receipt;
  const fixtureBytes = await readFile(resolve(receipt.fixture?.path ?? ""));
  const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
  const failures: string[] = [];
  if (!receipt.fixture?.sha256 || fixtureHash !== receipt.fixture.sha256)
    failures.push("fixture hash mismatch");
  if (fixtureBytes.byteLength !== receipt.fixture?.bytes) failures.push("fixture size mismatch");
  if (receipt.reconstruction?.valid !== true) failures.push("reconstruction invalid");
  if (!receipt.runs?.length || receipt.runs.some(run => run.cursorCorrect !== true))
    failures.push("catch-up cursor incorrect");
  if (receipt.exactResume?.cursorCorrect !== true) failures.push("exact resume cursor incorrect");
  if (!receipt.workerUrls?.length || receipt.workerUrls.some(url => !url.includes("game-session-worker.ts")))
    failures.push("module-worker URL missing");
  if (receipt.totalCatchUpAndStageMs === undefined || receipt.totalCatchUpAndStageMs > 30_000)
    failures.push("catch-up + reconstruction exceeds 30 s");
  if (receipt.within30Seconds !== true) failures.push("receipt does not claim the 30 s budget");
  return {
    pass: failures.length === 0,
    failures,
    receipt: path,
    receiptSha256: createHash("sha256").update(bytes).digest("hex"),
    fixture: { path: receipt.fixture?.path, bytes: receipt.fixture?.bytes, sha256: fixtureHash,
      archipelagoStripped: receipt.fixture?.archipelagoStripped },
    horizonSeconds: receipt.horizonSeconds,
    copies: receipt.copies,
    catchUpMs: receipt.catchUpWallMs,
    reconstructionMs: receipt.finalStageWallMs,
    catchUpAndReconstructionMs: receipt.totalCatchUpAndStageMs,
    exactResumeMs: receipt.exactResume?.wallMs,
    events: receipt.totalEconomyEvents,
    workerUrls: receipt.workerUrls,
    reconstructed: receipt.reconstruction,
    hostLoad: { start: receipt.host?.start?.loadAverage, end: receipt.host?.end?.loadAverage },
    scope: "Worker catch-up + final save reconstruction only; excludes UI, GPU, browser/server startup " +
      "and the separately measured exact 60 s resume."
  };
};
const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Pass one or more browser-worker receipt JSON paths");
const reports = [];
for (const path of paths) reports.push(await verify(resolve(path)));
const report = { verifiedAt: new Date().toISOString(), pass: reports.every(entry => entry.pass), reports };
if (process.env.OUTPUT)
  await writeFile(resolve(process.env.OUTPUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
