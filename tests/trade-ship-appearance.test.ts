import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { ENEMY_FACTION_COLOR, NEUTRAL_FACTION_COLOR } from "../src/render-common/settlement/player-color";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { shipFrame } from "../src/shared/settlement/settlement-naval-ship-handling";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const traders = () => {
  const sea = createShipSea(), harbour = sea.harbour(60);
  const fleet = createNavalFleet(sea.context, sea.sea);
  for (let queue = 1; queue <= 4; queue++)
    expect(fleet.sendVisitor(harbour.uid, { fish: 2 }, [], "trade", [], 0, undefined,
      { delivery: `appearance-${queue}`, queue })).not.toBeNull();
  return fleet;
};

describe("actual trade ship appearance", () => {
  it("derives all four neutral national hulls from persistent IDs without changing the saved fleet or goods", () => {
    const fleet = traders(), saved = JSON.parse(JSON.stringify(fleet.saveState()));
    const before = fleet.saveState().ships.map(shipFrame).map(({ id, livery, nation }) => ({ id, nation, livery }));
    expect(new Set(before.map(frame => frame.nation))).toEqual(new Set(["roman", "viking", "japanese", "nubian"]));
    expect(before.every(frame => frame.livery === "neutral")).toBe(true);
    expect(fleet.snapshot().map(({ id, livery, nation }) => ({ id, nation, livery }))).toEqual(before);
    expect(saved.ships.every((ship: { nation?: string; livery?: string }) => !ship.nation && !ship.livery)).toBe(true);
    fleet.restore(saved);
    expect(fleet.saveState().ships.map(shipFrame).map(({ id, livery, nation }) => ({ id, nation, livery }))).toEqual(before);
    expect(fleet.saveState().ships.reduce((sum, ship) => sum + (ship.cargo.fish ?? 0), 0)).toBe(8);
  });

  it.each(["high", "minimal"] as const)("uses canonical national hull batches and gray flags while own and hostile colors remain intact (%s)", quality => {
    const layer = createThreeSettlementShips(quality), frames = traders().saveState().ships.map(ship => ({ ...shipFrame(ship), phase: "idle" as const }));
    const color: [number, number, number] = [.2, .7, .1];
    const hull = (id: number) => layer.group.getObjectByName(`ship-${id}`)!.getObjectByName("ship_hull")!
      .children.flatMap(child => child instanceof Mesh ? [child] : child.children)
      .filter((child): child is Mesh => child instanceof Mesh).map(child => child.geometry.uuid);
    const flag = (id: number) => (layer.group.getObjectByName(`ship-${id}`)!.getObjectByName("ship_flag") as Mesh)
      .material as MeshStandardMaterial;
    for (const frame of frames) {
      const owned = { ...frame, id: 100, livery: undefined, nation: undefined, x: frame.x + 20 };
      const enemy = { ...owned, id: 101, livery: "enemy" as const, x: frame.x + 40 };
      layer.update([frame, owned, enemy], [], 0, { playerNation: frame.nation, playerColor: color });
      expect(hull(frame.id)).toEqual(hull(100));
      const figurehead = (id: number) => layer.group.getObjectByName(`ship-${id}`)!
        .getObjectByName("ship_figurehead")!.children.filter(child => child.visible).map(child => child.name);
      expect(figurehead(frame.id)).toEqual(figurehead(100));
      expect(flag(frame.id).color.toArray()).toEqual([...NEUTRAL_FACTION_COLOR]);
      expect(flag(100).color.toArray()).toEqual(color);
      expect(flag(101).color.toArray()).toEqual(ENEMY_FACTION_COLOR);
      const previousHull = hull(frame.id);
      layer.update([frame], [], 1, { playerNation: "roman", playerColor: [.7, .1, .2] });
      expect(hull(frame.id)).toEqual(previousHull);
      expect(flag(frame.id).color.toArray()).toEqual([...NEUTRAL_FACTION_COLOR]);
    }
    layer.dispose();
  });
});
