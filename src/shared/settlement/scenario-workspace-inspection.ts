import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { getGrowthState } from "../../render-common/growth/tree-growth";
import { WHEAT_BATCH_SIZE } from "../balance/economy";
import { sampleSmooth } from "../world/grid-geometry";
import { nationDrinkChain } from "./nation-drinks";
import { getProductionRule } from "./production-rules";
import { type ScenarioWildlifeSnapshot,validScenarioWildlife } from "./scenario-wildlife-inspection";
import { createSettlementFieldCycles, type SettlementFieldFrame } from "./settlement-field-cycles";
import { buildingNation } from "./settlement-nation";
import { findWorkTarget, targetKey } from "./settlement-resources";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export interface ScenarioWorkWitness {
  typeId: number;
  buildingUid?: number;
  kind: string;
  outcome: "witness" | "unknown";
  points: Array<{ x: number; z: number }>;
  searches: number;
  detail: string;
}

/** Exact shared stock approaches for completed spatial drafts, without construction/inventory mutation. */
const bindInspectionStockContacts = (context: SettlementContext) => {
  context.options.stockContact = (building, kind, ware, slot) => {
    const contact = getBuildingStockContact(building.typeId, kind, ware, slot, building.x, building.z,
      building.rotation, building.y, kind === "output" ? building.output : building.input,
      kind === "output" ? building.input : building.output, stockStyleFor(buildingNation(context, building), building));
    return contact ? { ware, slot: contact.slot, yaw: contact.wareYaw, scale: contact.scale,
      scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] },
      stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
      approach: { x: contact.approach[0], z: contact.approach[2], y: sampleSmooth(context.options.world,
        context.options.world.heights, contact.approach[0], contact.approach[2]) } } : null;
  };
};

const getInspectionCropKind = (context: SettlementContext, typeId: number): SettlementFieldFrame["kind"] => {
  if (typeId === 37) return "grain";
  if (typeId === 60) return "flax";
  if (typeId === 27) return "charcoal";
  return nationDrinkChain(context.playerNation).plantation;
};

/** One inspection session owns private reservations: two jobs cannot claim one initial finite target. */
export const createScenarioWorkspaceInspector = (context: SettlementContext, deadline = Infinity,
  wildlife?: ScenarioWildlifeSnapshot) => {
  const scratch: SettlementContext = { ...context, options: { ...context.options },
    reservations: new Set(context.reservations), resourceAmounts: new Map(context.resourceAmounts) };
  const previousHarvest = scratch.options.canHarvestTree;
  scratch.options.canHarvestTree = id => {
    const age = scratch.options.world.authoredTreeAges?.[id];
    return previousHarvest?.(id) !== false && (age === undefined || getGrowthState(age) === null);
  };
  const hasWildlife = validScenarioWildlife(wildlife, scratch.options.world);
  const previousTargets = scratch.options.resourceTargets;
  if (hasWildlife) scratch.options.resourceTargets = (kind, near, range) => kind === "wildlife"
    ? wildlife!.targets.filter(target => Math.hypot(target.x - near.x, target.z - near.z) <= range)
    : previousTargets?.(kind, near, range);
  bindInspectionStockContacts(scratch);
  const fields = createSettlementFieldCycles(scratch), sites: SettlementFieldFrame[] = [];
  const remainingStock = { ...scratch.options.world.scenario?.stock };
  scratch.fieldCycles = fields;
  const inspect = (building: SettlementBuilding): ScenarioWorkWitness[] => {
    const kind = getProductionRule(building.typeId, scratch.playerNation)?.outdoor;
    if (!kind) return [];
    const result: ScenarioWorkWitness = { typeId: building.typeId, buildingUid: building.uid,
      kind, searches: 0, points: [], outcome: "unknown", detail: "" };
    if (performance.now() >= deadline) {
      result.detail = "Inspection time budget reached before this work area was searched.";
      return [result];
    }
    if (kind === "wildlife" && !hasWildlife) {
      result.detail = wildlife?.overflow ? "Native animal snapshot exceeded its payload limit; hunting remains UNKNOWN."
        : "No valid native animal-pool snapshot is available; no prey was invented.";
      return [result];
    }
    if (kind === "field") {
      if (![5, 27, 37, 60].includes(building.typeId)) {
        result.detail = "No native crop-cycle provider for this occupation; generic terrain is insufficient.";
        return [result];
      }
      // Only authored real stock can support an input-consuming first operation (e.g. charcoal logs).
      const supplied = { ...building, input: { ...building.input } };
      const rule = getProductionRule(building.typeId, scratch.playerNation)!;
      for (const ware of rule.inputs) if ((remainingStock[ware] ?? 0) > 0)
        supplied.input[ware] = Math.max(supplied.input[ware] ?? 0, 1);
      const work = fields.findWork(supplied, () => ++result.searches <= 16 && performance.now() < deadline);
      result.searches = Math.min(result.searches, 16);
      if (!work) {
        result.detail = "No native initial crop operation within 16 path queries and authored input stock; not an impossibility proof.";
        return [result];
      }
      for (const ware of work.inputs) if (!(building.input[ware] ?? 0))
        remainingStock[ware] = Math.max(0, (remainingStock[ware] ?? 0) - 1);
      const targets = [work.target, ...work.batch ?? []];
      const cropKind = getInspectionCropKind(scratch, building.typeId);
      for (const target of targets) {
        scratch.reservations.add(targetKey(target));
        sites.push({ id: target.id, owner: building.uid, kind: cropKind, x: target.x, z: target.z,
          state: "growing", progress: 0, step: 0 });
      }
      fields.restore(sites);
      result.points = targets.map(({ x, z }) => ({ x, z }));
      result.outcome = "witness";
      result.detail = `Native ${cropKind} initial operation: ${targets.length}` +
        (building.typeId === 37 ? `/${WHEAT_BATCH_SIZE} wheat batch cells` : " work cell(s)") +
        "; real spacing, road/stock clearance and work approach, excluding earlier claimed cells. " +
        "Initial work only: later growth, complete-cycle input supply and sustainable yield remain unverified.";
      return [result];
    }
    let found: ReturnType<typeof findWorkTarget> = null;
    while (result.searches < 8 && !found && performance.now() < deadline) {
      result.searches++; found = findWorkTarget(scratch, building, kind);
    }
    if (found) {
      scratch.reservations.add(targetKey(found.target));
      result.points = [{ x: found.target.x, z: found.target.z }];
      result.outcome = "witness";
    }
    if (!found) {
      result.detail = "No unclaimed native target/path within 8 resumable searches; " +
        "contention, missing provider or search exhaustion remain UNKNOWN.";
      return [result];
    }
    result.detail = "One native initial target/path exists after planned buildings/roads, " +
      "excluding earlier claimed targets. This does not prove sustained yield, natural growth or traffic throughput.";
    if (kind === "wildlife") {
      result.detail = `One of ${wildlife!.targets.length} native live huntable animals has a shared ` +
        "hunter stand-off path, excluding earlier claims. This is a static current-population witness; " +
        "prey movement, pursuit, kills, replenishment and sustainable yield remain unverified.";
    }
    return [result];
  };
  return { inspect };
};
