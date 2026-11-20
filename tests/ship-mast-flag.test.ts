import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { ENEMY_FACTION_COLOR, NEUTRAL_FACTION_COLOR } from "../src/render-common/settlement/player-color";
import { createShipMastFlag } from "../src/renderers/three/settlement/ship-mast-flag";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { SHIPYARD_MAST_CLOTH } from "../src/shared/settlement/shipyard-recipes";

const ship = { id: 1, x: 0, y: 0, z: 0, yaw: 0, phase: "idle" as const, cargoCount: 0 };

describe("merchant mast flag", () => {
  it.each([true, false])(
    "keeps its hoist fixed and hangs lower in calm air (detailed=%s)",
    (detailed) => {
      const flag = createShipMastFlag(detailed),
        mesh = flag.createMesh();
      flag.update(0, 0);
      const calm = Array.from(mesh.geometry.getAttribute("position").array);
      flag.update(1.3, 1);
      const positions = mesh.geometry.getAttribute("position");
      let animated = 0;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getX(i) === positions.getX(0)) {
          expect(positions.getY(i)).toBe(calm[i * 3 + 1]);
          expect(Math.abs(positions.getZ(i))).toBe(0);
        } else {
          expect(positions.getY(i)).toBeGreaterThan(calm[i * 3 + 1]!);
          if (positions.getZ(i) !== calm[i * 3 + 2]) animated++;
        }
      }
      expect(animated).toBeGreaterThan(0);
      // The textile is wholly above the yard and cannot pass through the existing sail or its stays.
      const bounds = new Box3().setFromObject(mesh);
      expect(bounds.min.y).toBeGreaterThan(1.68);
      expect(bounds.max.x).toBeLessThan(0.5);
      expect(mesh.geometry.index!.count / 3).toBe(detailed ? 144 : 16);
      flag.dispose();
    }
  );
  it.each(["high", "minimal"] as const)(
    "shares %s cloth, follows ship yaw and remains visible at the gameplay camera distance",
    (quality) => {
      const layer = createThreeSettlementShips(quality);
      layer.update([ship, { ...ship, id: 2, x: 20, yaw: Math.PI / 2 }], [], 0.6, { cameraX: 0 });
      const flags: Mesh[] = [];
      layer.group.traverse((object) => {
        if (object instanceof Mesh && object.name === "ship_flag") flags.push(object);
      });
      expect(flags).toHaveLength(2);
      expect(flags[0]!.geometry).toBe(flags[1]!.geometry);
      expect(flags.every((flag) => flag.visible)).toBe(true);
    layer.update([ship, { ...ship, id: 2, x: 20, yaw: Math.PI / 2 }], [], .6,
      { windDirection: Math.PI / 4, playerColor: [.2,.7,.1] });
    expect((flags[0]!.material as MeshStandardMaterial).color.toArray()).toEqual([.2,.7,.1]);
    expect(flags[0]!.rotation.y).toBeCloseTo(-Math.PI / 4);
    expect(flags[1]!.rotation.y).toBeCloseTo(-Math.PI * 3 / 4);
      const a = flags[0]!.getWorldPosition(new Vector3()),
        b = flags[1]!.getWorldPosition(new Vector3());
      expect(a.x).not.toBe(b.x);
      layer.update([ship], [], 0.8, { cameraX: 100, cameraY: 0, cameraZ: 0 });
      expect(flags[0]!.visible).toBe(true);
      layer.dispose();
    }
  );
  it.each(["high", "minimal"] as const)("hoists the flag only once the hull is finished (%s)", quality => {
      const layer = createThreeSettlementShips(quality);
      const site = { id: 7, x: 0, y: 0, z: 0, yaw: 0, progress: 0 };
      const flag = () => layer.group.getObjectByName("site-7")!.getObjectByName("ship_flag")!;
      layer.update([], [site], 0);
      expect(flag().visible).toBe(false); // just started: only the keel and ribs show
      layer.update([], [{ ...site, progress: .8, cloth: SHIPYARD_MAST_CLOTH }], .5);
      expect(flag().parent!.visible).toBe(true); // the rig is already drawn...
      expect(flag().visible).toBe(false); // ...but the hull is still under construction
      layer.update([], [{ ...site, progress: 1 }], 1);
      expect(flag().visible).toBe(true);
      layer.dispose();
    }
  );
  it.each(["high", "minimal"] as const)("flies enemy and neutral colours, never the player's (%s)", quality => {
    const layer = createThreeSettlementShips(quality);
    const player: [number, number, number] = [.2, .7, .1];
    layer.update([ship, { ...ship, id: 2, x: 20, livery: "enemy" }, { ...ship, id: 3, x: 40, livery: "neutral" }],
      [], .6, { playerColor: player });
    const named = (name: string) => {
      const meshes: Mesh[] = [];
      layer.group.traverse(object => { if (object instanceof Mesh && object.name === name) meshes.push(object); });
      return meshes.map(mesh => mesh.material as MeshStandardMaterial);
    };
    const [own, enemy, neutral] = named("ship_flag");
    expect(own!.color.toArray()).toEqual(player);
    expect(enemy!.color.toArray()).toEqual(ENEMY_FACTION_COLOR);
    expect(neutral!.color.toArray()).toEqual([...NEUTRAL_FACTION_COLOR]);
    const sails = named("ship_sail");
    expect(new Set(sails).size).toBe(3);
    layer.dispose();
  });
});
