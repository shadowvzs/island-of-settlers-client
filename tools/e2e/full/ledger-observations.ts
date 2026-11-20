import type { SettlementActor, SettlementBuilding } from "../../../src/shared/settlement/settlement-types";

export interface GoodsLedger {
  totals: Record<string, number>;
  invalid: Array<{ owner: string; ware: string; amount: number }>;
  /** Reservations are obligations, not additional goods. */
  reservations: Record<string, number>;
}
/** Physical stocks/cargo only. Pass additional naval/off-map ledgers explicitly when in scope. */
export const observeGoodsLedger = (
  buildings: readonly SettlementBuilding[], actors: readonly SettlementActor[],
  external: readonly { owner: string; goods: Readonly<Record<string, number>> }[] = []
): GoodsLedger => {
  const result: GoodsLedger = { totals: {}, invalid: [], reservations: {} };
  const add = (owner: string, goods: Readonly<Record<string, number>>, target = result.totals) => {
    for (const [ware, amount] of Object.entries(goods)) {
      if (!Number.isFinite(amount) || amount < 0) result.invalid.push({ owner, ware, amount });
      target[ware] = (target[ware] ?? 0) + amount;
    }
  };
  for (const building of buildings) {
    for (const key of ["inventory", "input", "output"] as const) add(`${building.uid}:${key}`, building[key]);
    add(`${building.uid}:incoming`, building.incoming, result.reservations);
  }
  for (const actor of actors) {
    if (actor.ware) add(`actor:${actor.uid}`, { [actor.ware]: 1 });
    if (actor.handcart?.trip) {
      const trip = actor.handcart.trip;
      add(`cart:${actor.uid}`, { [trip.ware]: actor.handcart.cargo + trip.prepaid });
    }
    if (actor.demolitionCargo) add(`demolition:${actor.uid}`, actor.demolitionCargo);
  }
  for (const entry of external) add(entry.owner, entry.goods);
  return result;
};

export const compareGoodsLedger = (
  before: GoodsLedger, after: GoodsLedger,
  declaredFlows: readonly { reason: string; goods: Readonly<Record<string, number>> }[] = []
) => {
  const expected: Record<string, number> = {};
  for (const flow of declaredFlows) for (const [ware, count] of Object.entries(flow.goods))
    expected[ware] = (expected[ware] ?? 0) + count;
  const rows = [...new Set([...Object.keys(before.totals), ...Object.keys(after.totals), ...Object.keys(expected)])]
    .sort().map(ware => {
      const actual = (after.totals[ware] ?? 0) - (before.totals[ware] ?? 0);
      return { ware, actual, expected: expected[ware] ?? 0, unexplained: actual - (expected[ware] ?? 0) };
    });
  return { rows, unexplained: rows.filter(row => Math.abs(row.unexplained) > 1e-6),
    invalid: [...before.invalid, ...after.invalid] };
};
