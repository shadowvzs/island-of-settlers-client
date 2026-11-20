import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import { isRoadDecorationAction, type RoadDecorationAction } from "../../../../island-of-settlers-shared/src/road-decoration-custody";
import { isRoadDecorationItemId, type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { RoadDecorationReturn } from "../../shared/settlement/road-decoration-state";
import { createHeadlessIsland } from "./headless-replay";

/** Only a stored verified island and its locked server wallet are supplied by the API, never browser snapshots. */
export const mutateSavedRoadDecoration = async (input: unknown, action: RoadDecorationAction,
  wallet: Readonly<Record<string, number | undefined>>) => {
  if (!input || typeof input !== "object" || !isRoadDecorationAction(action)) return null;
  const baseline = structuredClone(input) as GameSaveV1;
  if (baseline.format !== FORMATS.gameSave.id || !baseline.settlement || !baseline.player) return null;
  const items: Record<string, number> = {};
  for (const [item, count] of Object.entries(wallet)) if (isRoadDecorationItemId(item)) {
    if (!Number.isSafeInteger(count) || count! < 0) return null;
    if (count) items[item] = count;
  }
  const island = await createHeadlessIsland(baseline, false, false, {
    roadDecorationCustody: {
      consume: item => { if (!items[item]) return false; items[item]!--; return true; },
      receive: added => { for (const [item, count] of Object.entries(added)) items[item] = (items[item] ?? 0) + count; return true; }
    }
  });
  const simulation = island.simulation;
  let placed: { uid: number; item: RoadDecorationItemId } | undefined;
  let updated: { uid: number; item: RoadDecorationItemId } | undefined;
  let returned: RoadDecorationReturn[] = [];
  if (action.kind === "place") {
    const result = simulation.placeRoadDecoration(action.order);
    if (!result.ok) return { ok: false as const, reason: result.reason };
    placed = { uid: result.uid, item: action.order.item };
  } else if (action.kind === "rotate" || action.kind === "move") {
    const result = action.kind === "rotate" ? simulation.rotateRoadDecoration(action.uid) :
      simulation.moveRoadDecoration(action.uid, action.position, action.yaw);
    if (!result.ok) return { ok: false as const, reason: result.reason };
    updated = { uid: result.uid, item: result.item };
  } else {
    if (action.kind === "pick-up") simulation.pickUpRoadDecoration(action.uid);
    const selected = action.kind === "claim-returns" ? new Set(action.ids) :
      new Set(simulation.pendingRoadDecorationReturns().filter(row => row.source === action.uid).map(row => row.id));
    returned = simulation.pendingRoadDecorationReturns().filter(row => selected.has(row.id)).map(row => ({ ...row }));
    const claimed = simulation.claimRoadDecorationReturns([...selected]);
    if (!claimed.ok) return claimed;
  }
  const saved = await island.save();
  // Browser snapshots cross JSON before storage. Match that boundary while refusing non-finite state.
  const game = JSON.parse(JSON.stringify({ ...baseline, ...saved }, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid road decoration game value");
    return value;
  })) as GameSaveV1;
  return { ok: true as const, game, placed, returned, updated };
};
