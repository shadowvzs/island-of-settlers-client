import { describe, expect, it } from "vitest";

import type { MilitaryStructure } from "../src/shared/settlement/fort-assault-rules";
import { spawnHostileNear } from "../src/shared/settlement/settlement-colony";
import {
  AUTO_ASSAULT_RANGE, hostileFortStatus, watchHostileForts
} from "../src/shared/settlement/settlement-colony-forts";
import type { createSettlementMilitary, SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

type Military = ReturnType<typeof createSettlementMilitary>;
const fort = { access: { x: 10, z: 10 }, status: "", typeId: 2, uid: 7 } as SettlementBuilding;

const soldier = (actor: number, faction: number, extra: Record<string, unknown> = {}): SettlementSoldier => ({
  actor, building: -3, rank: 0, stationed: false,
  combat: { cooldown: 0, faction, hp: 100, type: "shield", ...extra } as SettlementSoldier["combat"]
});

/** Player soldiers stand at the given distances east of the fort's door. */
const scene = (soldiers: SettlementSoldier[], distances: Record<number, number>,
  structure: MilitaryStructure = { hp: 20_000, maximum: 20_000 }) => {
  const sieges: Array<{ ids: readonly number[]; uid: number }> = [];
  const military = {
    combat: {
      doors: () => [{ building: 7, faction: 1, hp: 150, maximum: 150, structure }],
      siege: (ids: readonly number[], uid: number) => { sieges.push({ ids, uid }); return true; }
    },
    soldiers: () => soldiers
  } as unknown as Military;
  const actors = Object.entries(distances).map(([uid, distance]) =>
    ({ phase: "militaryField", uid: Number(uid), x: 10 + distance, z: 10 }));
  const context = { actors } as unknown as SettlementContext;
  return { context, military, sieges };
};

describe("colony fort watch", () => {
  it("labels a held fort with its defenders and leaves it to an ordered siege", () => {
    const defenders = [{ ...soldier(1, 1), building: 7, stationed: true }, { ...soldier(2, 1), building: 7 }];
    const { context, military, sieges } = scene([...defenders, soldier(3, 0)], { 3: 2 });
    const target = { ...fort };
    expect(watchHostileForts(context, military, [target]))
      .toEqual([{ defenders: 2, hp: 20_000, maximum: 20_000, typeId: 2, uid: 7 }]);
    expect(target.status).toBe("Enemy fort · 2 defenders");
    expect(sieges).toEqual([]);
  });

  it("sends idle soldiers of every kind near an undefended fort's door against its walls", () => {
    const soldiers = [
      soldier(10, 0), soldier(11, 0), soldier(12, 0, { type: "cavalry" }), soldier(15, 0, { type: "archer" }),
      soldier(13, 0, { destination: { x: 0, z: 0 } }), soldier(14, 0, { target: 99 }), soldier(16, 0, { siege: 7 })
    ];
    const { context, military, sieges } = scene(soldiers,
      { 10: 3, 11: AUTO_ASSAULT_RANGE + 5, 12: 1, 13: 1, 14: 1, 15: 6, 16: 1 });
    const target = { ...fort };
    watchHostileForts(context, military, [target]);
    expect(target.status).toBe("Undefended · walls 20,000 / 20,000");
    expect(sieges).toEqual([{ ids: [10, 12, 15], uid: 7 }]);
  });

  it("leaves fallen walls alone and reports the fall", () => {
    const fallen = { fallen: 1, hp: 0, maximum: 20_000 };
    const { context, military, sieges } = scene([soldier(10, 0)], { 10: 1 }, fallen);
    const target = { ...fort };
    expect(watchHostileForts(context, military, [target])[0]).toMatchObject({ fallen: 1, hp: 0 });
    expect(target.status).toBe(hostileFortStatus(0, fallen));
    expect(target.status).toBe("Destroyed · burning down");
    expect(sieges).toEqual([]);
  });

  it("never spawns a hostile soldier on ground the harbour cannot reach", () => {
    const points: Array<{ x: number; z: number }> = [];
    const military = { combat: { spawnOpponent: (point: { x: number; z: number }) => {
      points.push(point); return points.length;
    } } } as unknown as Military;
    // Everything west of the door is an isolated spit; the first ring point (east) is reachable.
    const id = spawnHostileNear(military, { x: 10, z: 10 }, "archer", 0,
      { reachable: point => point.x > 10.5 });
    expect(id).toBe(1);
    expect(points.every(point => point.x > 10.5)).toBe(true);
    expect(spawnHostileNear(military, { x: 10, z: 10 }, "archer", 0, { reachable: () => false })).toBeNull();
  });
});
