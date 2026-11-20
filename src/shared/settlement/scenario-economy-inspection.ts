import type { WorldData } from "../world/world-data";
import { getProductionRule } from "./production-rules";
import { constructionCost } from "./settlement-placement";
import type { ScenarioSpaceReport } from "./settlement-scenario-space";

export interface EconomyFinding {
  name: string;
  outcome: "witness" | "unknown";
  detail: string;
}

/** Necessary starting conditions and dependency witnesses; never silently grants infinite stock.
 * Construction totals are an upfront-cost diagnostic, not a claim that phased production fails. */
export const inspectScenarioEconomy = (world: WorldData, space: ScenarioSpaceReport): EconomyFinding[] => {
  const scenario = world.scenario;
  if (!scenario?.headquarters || space.authoredErrors.length || !space.stages.length)
    return [{ name: "Starting economy", outcome: "unknown", detail: "Repair the authored start and inspect its planned plots first." }];
  const required = [...new Set(space.stages.filter(stage => stage.mandatory).flatMap(stage => stage.required))];
  const found = new Set(space.stages.flatMap(stage => stage.found));
  const rules = required.flatMap(typeId => {
    const rule = getProductionRule(typeId, scenario.nation);
    return rule ? [{ typeId, rule }] : [];
  });
  const tools: Record<string, number> = { hammer: 1 };
  for (const { rule } of rules) if (rule.tool) tools[rule.tool] = (tools[rule.tool] ?? 0) + 1;
  const missingTools = Object.entries(tools).filter(([ware, count]) => (scenario.stock[ware] ?? 0) < count);
  const minimumWorkers = rules.length + 2; // One assigned worker per listed producer, one builder and one carrier.
  const findings: EconomyFinding[] = [
    { name: "Starting worker tools", outcome: missingTools.length ? "unknown" : "witness",
      detail: missingTools.length ? `Startup staffing needs ${missingTools.map(([ware, count]) =>
        `${count} ${ware} (${scenario.stock[ware] ?? 0} supplied)`).join(", ")}. Tool production/import can resolve this; none was assumed.` :
        "Authored stock can equip the listed startup workers and one builder simultaneously; carriers need no tool." },
    { name: "Starting workforce", outcome: scenario.settlers >= minimumWorkers ? "witness" : "unknown",
      detail: `${scenario.settlers}/${minimumWorkers} settlers for the listed producers, one builder and one carrier. ` +
        "This does not reserve troops, extra carriers or optional occupations." }
  ];
  const costs: Record<string, number> = {};
  for (const typeId of required) for (const [ware, count] of Object.entries(constructionCost(typeId, scenario.nation)))
    costs[ware] = (costs[ware] ?? 0) + count;
  const shortfalls = Object.entries(costs).filter(([ware, count]) => (scenario.stock[ware] ?? 0) < count);
  findings.push({ name: "Startup construction materials", outcome: shortfalls.length ? "unknown" : "witness",
    detail: shortfalls.length ? `Upfront construction shortfalls: ${shortfalls.map(([ware, count]) =>
      `${ware} ${count - (scenario.stock[ware] ?? 0)}`).join(", ")}. Phased construction and finite local production/import need verification; this is not an impossibility result.` :
      "Authored stock covers the listed startup building costs upfront, excluding optional roads, upgrades and resource consumption." });
  const available = new Set(Object.entries(scenario.stock).filter(([, count]) => count > 0).map(([ware]) => ware));
  const unresolved = new Map(rules.map(entry => [entry.typeId, entry]));
  for (let pass = 0; pass < rules.length; pass++) {
    let advanced = false;
    for (const [typeId, { rule }] of unresolved) {
      if (!found.has(typeId)) continue;
      const workspace = space.workspaces.filter(witness => witness.typeId === typeId);
      if (rule.outdoor && !workspace.some(witness => witness.kind === rule.outdoor && witness.outcome === "witness")) continue;
      if (rule.tool && !available.has(rule.tool)) continue;
      const supplied = rule.alternativeFood ? rule.inputs.some(ware => available.has(ware)) :
        rule.inputs.every(ware => available.has(ware));
      if (!supplied) continue;
      for (const output of rule.outputs) available.add(output);
      unresolved.delete(typeId); advanced = true;
    }
    if (!advanced) break;
  }
  findings.push({ name: "Startup production dependencies", outcome: unresolved.size ? "unknown" : "witness",
    detail: unresolved.size ? `Unproven startup chains: ${[...unresolved.values()].map(({ rule, typeId }) => {
      const missing = rule.inputs.filter(ware => !available.has(ware));
      return `${typeId}${missing.length ? ` needs ${missing.join("/")}` : " needs a legal plot, native work access or tool evidence"}`;
    }).join("; ")}. A colony's advanced logs do not substitute for base sawmill logs or construction wares; import them or unlock the matching recipe.` :
      "Every listed startup rule has an input/tool dependency witness and any required native outdoor approach. Finite input stock is not assumed renewable; quantities, yield, contention and throughput remain unverified." });
  return findings;
};
