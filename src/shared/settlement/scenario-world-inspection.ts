import type { WorldData } from "../world/world-data";
import { type EconomyFinding,inspectScenarioEconomy } from "./scenario-economy-inspection";
import { inspectWorldNavigation, type ScenarioWorldNavigation } from "./scenario-world-navigation";
import { inspectScenarioSpaceAsync, type ScenarioSpaceAsyncOptions, type ScenarioSpaceReport } from "./settlement-scenario-space";

export type ScenarioWorldReport = ScenarioSpaceReport & { navigation: ScenarioWorldNavigation; economy: EconomyFinding[] };
export interface ScenarioWorldInspectionOptions extends ScenarioSpaceAsyncOptions {
  navigationMilliseconds?: number;
  onPhase?: (phase: string) => void;
}
/** Shared pure driver; worker and headless regressions use identical steps and limits. */
export const inspectScenarioWorld = async (world: WorldData, options: ScenarioWorldInspectionOptions = {}) => {
  const budget = options.navigationMilliseconds ?? 15000;
  if (!Number.isFinite(budget) || budget < 0 || budget > 60000) throw new Error("Navigation inspection budget must be0–60000ms");
  const boundary = { scenario: world.scenario, heights: world.heights, water: world.waterSurface, props: world.props, count: world.props.count, build: world.buildRevision, terrain: world.terrainRevision };
  const current = () => options.isCurrent?.() !== false && boundary.scenario === world.scenario && boundary.heights === world.heights &&
    boundary.water === world.waterSurface && boundary.props === world.props && boundary.count === world.props.count &&
    boundary.build === world.buildRevision && boundary.terrain === world.terrainRevision;
  const space = await inspectScenarioSpaceAsync(world, { ...options, isCurrent: current });
  const economy = inspectScenarioEconomy(world, space);
  space.messages.push(...economy.map(finding => `${finding.name}: ${finding.outcome.toUpperCase()}. ${finding.detail}`));
  const steps = inspectWorldNavigation(world, space.harbours, budget);
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  for (;;) {
    if (options.signal?.aborted || !current())
      throw new DOMException("Map changed or navigation inspection cancelled.", "AbortError");
    const step = steps.next();
    if (step.done) return { ...space, economy, navigation: step.value } satisfies ScenarioWorldReport;
    options.onPhase?.(step.value);
    await yieldControl();
  }
};
