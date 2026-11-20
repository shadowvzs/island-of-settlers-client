import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SHIPPED_MILITARY_AI_MODE, SHIPPED_MILITARY_AI_MODE_LABEL
} from "../../src/shared/settlement/military-ai-mode";
import { launchBrowser, startDevServer } from "./browser";
import { closeDevelopment, openDevelopmentCategory } from "./development-ui-helpers";
import {
  gameErrors, lookAt, openFreshIsland, runDevelopmentTool, sailUntilLanded, trackPageErrors, visitIsland
} from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

type Page = import("playwright-core").Page;
/**
 * Opt-in synthetic native inspection: debug expedition grants, direct attack orders and controlled
 * fixed simulation steps. The UI shows the fixed shipped mode and the overlay; each quality gets a
 * fresh context. This is not ordinary-user journey acceptance or a browser performance benchmark.
 * QUALITIES=high,minimal; EXPEDITION=adventure|colony.
 */
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",").map(value => value.trim());
const expeditionKind = process.env.EXPEDITION ?? "adventure";
if (qualities.some(quality => !["high", "minimal"].includes(quality))) throw new Error("Invalid QUALITIES");
if (!["adventure", "colony"].includes(expeditionKind)) throw new Error("Invalid EXPEDITION");
const measured = new Date().toISOString();
const output = resourcesPath("settlement-previews", "military-ai-modes", measured.replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const report: Record<string, unknown> = {
  measured, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  scope: "Synthetic debug expedition fixture; direct orders/fixed updates; not normal-user gameplay acceptance",
  comparison: "Fresh independent contexts per quality; screenshots and diagnostics, not performance measurements",
  expeditionKind,
  mode: SHIPPED_MILITARY_AI_MODE
};

const freeze = (page: Page, frozen: boolean) => page.evaluate(frozen => {
  const simulation = (window as any).__settlement.simulation;
  if (frozen) {
    simulation.__militaryReviewUpdate ??= simulation.update;
    simulation.update = () => undefined;
  } else if (simulation.__militaryReviewUpdate) {
    simulation.update = simulation.__militaryReviewUpdate; delete simulation.__militaryReviewUpdate;
  }
}, frozen);
const advance = (page: Page, seconds: number) => page.evaluate(async seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < seconds * 20; tick++) {
    (simulation.__militaryReviewUpdate ?? simulation.update)(.05);
    if (tick % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
}, seconds);

const attackNearestCamp = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const bodies = new Map<number, any>(simulation.frames().map((actor: any) => [actor.uid, actor]));
  const ours = simulation.militarySoldiers().filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0 &&
    bodies.get(soldier.actor)?.phase === "militaryField");
  if (!ours.length) throw new Error("Missing fixture prerequisite: no deployed free player troops");
  const centre = ours.reduce((point: { x: number; z: number }, soldier: any) => {
    const body = bodies.get(soldier.actor)!;
    return { x: point.x + body.x / ours.length, z: point.z + body.z / ours.length };
  }, { x: 0, z: 0 });
  const enemies = simulation.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0)
    .map((building: any) => building.access);
  enemies.push(...simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.faction > 0 &&
    bodies.get(soldier.actor)?.phase === "militaryField").map((soldier: any) => bodies.get(soldier.actor)));
  const enemy = enemies.sort((a: any, b: any) => Math.hypot(a.x - centre.x, a.z - centre.z) -
    Math.hypot(b.x - centre.x, b.z - centre.z))[0];
  if (!enemy) throw new Error("Missing fixture prerequisite: no hostile camp or field troop");
  if (!simulation.commandMilitary(ours.map((soldier: any) => soldier.actor), enemy, "attackMove"))
    throw new Error("The synthetic attack order was rejected");
  return { centre, enemy: { x: enemy.x, z: enemy.z }, troops: ours.length };
});

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const key = `${expeditionKind}-${quality}-${SHIPPED_MILITARY_AI_MODE}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage(); let stage = "island";
    const errors = trackPageErrors(page, () => stage);
    try {
      await openFreshIsland(page, url, quality);
      stage = "debug expedition";
      await runDevelopmentTool(page, expeditionKind === "colony" ? "Test colony expedition" : "Test adventure",
        async () => undefined);
      const landed = await sailUntilLanded(page);
      if (landed.status !== "arrived") throw new Error("Debug expedition did not arrive within its bound");
      await visitIsland(page, expeditionKind === "colony" ? "[data-colony-visit]" : "[data-adventure-visit]");
      stage = "mode UI";
      const panel = await openDevelopmentCategory(page, "Military");
      await panel.getByText(`Mode: ${SHIPPED_MILITARY_AI_MODE_LABEL}`, { exact: true }).waitFor();
      const actual = await page.evaluate(() => (window as any).__settlement.simulation.militaryAiMode());
      if (actual !== SHIPPED_MILITARY_AI_MODE)
        throw new Error(`Expected ${SHIPPED_MILITARY_AI_MODE} but backend reports ${actual}`);
      await panel.getByRole("checkbox", { name: "AI debug overlay (flow, influence)", exact: true }).check();
      await page.screenshot({ path: resolve(output, `${key}-menu.png`) });
      await closeDevelopment(page); await freeze(page, true);
      if (expeditionKind === "colony") await page.evaluate(() => {
        const simulation = (window as any).__settlement.simulation, home = simulation.home();
        if (home) simulation.callOutMilitary(["shield", "heavy", "archer", "cavalry"], home.access);
      });
      await advance(page, 40); stage = "attack";
      const order = await attackNearestCamp(page); await advance(page, 7);
      const currentCentre = await page.evaluate(() => {
        const simulation = (window as any).__settlement.simulation;
        const ids = new Set(simulation.militarySoldiers().filter((soldier: any) =>
          (soldier.combat?.faction ?? 0) === 0).map((soldier: any) => soldier.actor));
        const troops = simulation.frames().filter((actor: any) => ids.has(actor.uid) && actor.visible);
        if (!troops.length) return null;
        return { x: troops.reduce((sum: number, actor: any) => sum + actor.x, 0) / troops.length,
          z: troops.reduce((sum: number, actor: any) => sum + actor.z, 0) / troops.length };
      });
      await lookAt(page, currentCentre ?? order.enemy); await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(output, `${key}-attack.png`) });
      await advance(page, 12); await lookAt(page, order.enemy); await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(output, `${key}-battle.png`) });
      const debug = await page.evaluate(() => {
        const simulation = (window as any).__settlement.simulation, data = simulation.militaryAiDebug();
        return { mode: simulation.militaryAiMode(), fields: data.flowFields.length,
          owners: data.owners, handovers: data.handovers,
          decisions: data.commander.decisions, navigation: simulation.navigationDiagnostics() };
      });
      const observedErrors = gameErrors(errors);
      report[key] = { order, debug, errors: observedErrors };
      if (observedErrors.length) process.exitCode = 1;
    } catch (error) {
      report[key] = { stage, error: error instanceof Error ? error.message : String(error), errors: gameErrors(errors) };
      process.exitCode = 1;
    } finally {
      await freeze(page, false).catch(() => undefined); await context.close();
    }
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(`Saved synthetic native review artifacts: ${output}`);
