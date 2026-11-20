import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBridgeSummary } from "../settlement-ui/types";

const addGoods = (first: Readonly<Record<string, number>>, second: Readonly<Record<string, number>>) => {
  const total: Record<string, number> = { ...first };
  for (const [ware, count] of Object.entries(second)) total[ware] = (total[ware] ?? 0) + count;
  return total;
};

/** Bridge panel rows: every bridge with its site and next-upgrade availability (bridges are few). */
export const getBridgeSummaries = (simulation: SettlementSimulation): SettlementBridgeSummary[] =>
  simulation.bridges().map(bridge => {
    const site = bridge.site;
    return {
      completed: bridge.completed,
      id: String(bridge.id),
      kind: bridge.kind,
      level: bridge.level,
      ...(bridge.removal ? { removal: { ...bridge.removal } } : {}),
      ...(site ? { site: {
        delivered: addGoods(site.delivered, site.consumed),
        incoming: { ...site.incoming },
        progress: site.progress,
        required: Object.fromEntries(Object.entries(site.required).filter(([, count]) => count > 0)),
        stage: site.stage,
        ...(site.upgrade ? { upgradeTo: site.upgrade.level + 1 } : {})
      } } : {}),
      tiles: bridge.tiles,
      upgrade: simulation.bridgeUpgradeAvailability(bridge.id)
    };
  });
