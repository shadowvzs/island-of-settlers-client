import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { OfflineEconomyEventsResult, OfflineEconomyJob } from "./offline-economy-events";

interface InputBuffer { building: SettlementBuilding; uid: string; goods: Goods; snapshot: string }
const own = (goods: Readonly<Goods>, ware: string) => Object.hasOwn(goods, ware) ? goods[ware]! : 0;

/** Existing workshop buffers fund only their owner; native planned pickups retain their complete buffer. */
export const prepareOfflineEconomyInputs = (
  save: GameSaveV1, islandId: string, jobs: OfflineEconomyJob[]
) => {
  const state = save.settlement, buffers: InputBuffer[] = [], notes: string[] = [];
  const reserved = (uid: number) => state.actors.some(actor =>
    (actor.building === uid && !!actor.productionInputs?.length) ||
    (actor.delivery?.source === uid && actor.delivery.sourceInput));
  for (const job of jobs) {
    delete job.initialInputs;
    if (!job.inputTargets || job.kind === "transfer") continue;
    const building = state.buildings.find(building => job.uid === `building:${building.uid}`);
    if (!building || reserved(building.uid)) continue;
    const goods: Goods = {};
    for (const ware of Object.keys(job.inputTargets)) {
      const units = own(building.input, ware);
      if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid owned workshop input");
      if (units > 0) goods[ware] = units;
    }
    if (!Object.keys(goods).length) continue;
    job.initialInputs = { ...goods };
    buffers.push({ building, uid: `${islandId}:${job.uid}`, goods, snapshot: JSON.stringify(building.input) });
  }
  if (buffers.length) notes.push("Unreserved existing workshop inputs fund only their own recipe; " +
    "native planned input pickups and source-input delivery owners retain their complete buffers.");
  let applied = false;
  return { notes, apply: (results: OfflineEconomyEventsResult["buffers"]) => {
    if (applied) throw new Error("Offline inputs already applied");
    const changes: { building: SettlementBuilding; goods: Goods; remaining: Goods }[] = [];
    for (const buffer of buffers) {
      const remaining = results.find(result => result.uid === buffer.uid && result.islandId === islandId)?.ownedStock;
      if (!state.buildings.includes(buffer.building) || JSON.stringify(buffer.building.input) !== buffer.snapshot ||
        reserved(buffer.building.uid) || !remaining || Object.entries(remaining).some(([ware, units]) =>
          !Object.hasOwn(buffer.goods, ware) || !Number.isSafeInteger(units) || units < 0 || units > own(buffer.goods, ware)))
        throw new Error("Offline owned input balance changed before commit");
      changes.push({ building: buffer.building, goods: buffer.goods, remaining });
    }
    applied = true;
    for (const { building, goods, remaining } of changes) for (const [ware, units] of Object.entries(goods))
      building.input[ware] = own(building.input, ware) - units + own(remaining, ware);
  } };
};
