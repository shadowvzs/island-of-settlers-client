import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { NATION_DRINK_CHAINS, nationDrinkChain } from "./nation-drinks";
import type { SettlementSaveV1 } from "./settlement-save-state";

/** Debug nation changes exchange equivalent wares everywhere, including paid/in-flight receipts. */
export const migrateSettlementNation = (saved: SettlementSaveV1, nation: WorkerNation): SettlementSaveV1 => {
  const chain = nationDrinkChain(nation);
  const wares = new Map<string, string>();
  const crops = new Map<string, string>();
  const jobs = new Map<string, string>();
  for (const previous of Object.values(NATION_DRINK_CHAINS)) {
    wares.set(previous.raw, chain.raw);
    wares.set(previous.drink, chain.drink);
    crops.set(previous.plantation, chain.plantation);
    jobs.set(previous.grower, chain.grower);
    jobs.set(previous.maker, chain.maker);
  }
  const convert = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      if (key === "kind") return crops.get(value) ?? value;
      if (key === "job") return jobs.get(value) ?? value;
      return wares.get(value) ?? value;
    }
    if (Array.isArray(value)) return value.map(entry => convert(entry));
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      const target = wares.get(name) ?? name;
      const converted = convert(entry, name);
      result[target] = typeof converted === "number" && typeof result[target] === "number"
        ? (result[target] as number) + converted : converted;
    }
    return result;
  };
  const migrated = convert(saved) as SettlementSaveV1;
  migrated.playerNation = nation;
  for (const field of migrated.fields) {
    if (field.state === "fruiting" && !["hive", "palm"].includes(field.kind)) field.state = "growing";
  }
  // A stock contact contains the previous ware's dimensions/grip. Rebuild it on admission.
  for (const [index, actor] of migrated.actors.entries()) {
    const original = saved.actors[index]!;
    if (actor.stockContact && original.stockContact?.ware !== actor.stockContact.ware)
      actor.stockContact = undefined;
    if (actor.ware !== original.ware || actor.wareTransfer?.ware !== original.wareTransfer?.ware)
      actor.wareScale = undefined;
  }
  return migrated;
};
