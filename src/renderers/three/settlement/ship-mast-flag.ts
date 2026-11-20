import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial } from "three";

import { PLAYER_FLAG_POSES,playerFlagVertex, playerFlagWindWeights } from "../../../render-common/buildings/player-flag-motion";
import { DEFAULT_PLAYER_COLOR, ENEMY_FACTION_COLOR, NEUTRAL_FACTION_COLOR }
  from "../../../render-common/settlement/player-color";
import type { ShipLivery } from "../../../render-common/ships/ship-frame";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createPlayerFlagClothWeave } from "../buildings/roman-player-flag";

export interface ShipVisualEnvironment {
  playerColor?: [number, number, number];
  /** The player's nation: its ships carry the nation's figurehead (a dragon for Vikings). */
  playerNation?: WorkerNation;
  windStrength?: number;
  windDirection?: number;
  cameraX?: number;
  cameraY?: number;
  cameraZ?: number;
  /** Camera zoom: picks the detail level of the pirate ship models. */
  zoom?: number;
}

/**
 * The same woven cloth and wind folds as the HQ, pinned to the mast tip: player-coloured, or in the
 * enemy / neutral livery.
 */
export const createShipMastFlag = (detailed: boolean) => {
  const columns = detailed ? 12 : 4, rows = detailed ? 6 : 2;
  const geometry = new BufferGeometry();
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    vertices.push(.032 + column / columns * .43, 2.34 - row / rows * .27, 0);
    uvs.push(column / columns, 1 - row / rows);
    if (row < rows && column < columns) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const weave = createPlayerFlagClothWeave();
  const cloth = (color: readonly [number, number, number]) => {
    const material = new MeshStandardMaterial({ map: weave, roughness: .92, side: DoubleSide });
    material.color.setRGB(...color);
    return material;
  };
  // One cloth per livery: the player's colour follows the settings, enemy and neutral are fixed.
  const player = cloth(DEFAULT_PLAYER_COLOR);
  const liveries = { enemy: cloth(ENEMY_FACTION_COLOR), neutral: cloth(NEUTRAL_FACTION_COLOR) };
  const weights = new Array<number>(PLAYER_FLAG_POSES).fill(0);
  const update = (time: number, strength = .6, color: [number, number, number] = DEFAULT_PLAYER_COLOR) => {
    player.color.setRGB(...color);
    playerFlagWindWeights(time, strength, weights);
    const positions = geometry.getAttribute("position"), lift = weights.reduce((sum, weight) => sum + weight, 0);
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const x = column / columns * .43, y = .385 - row / rows * .27;
      const calm = playerFlagVertex(x, y, null);
      let px = calm[0] * (1 - lift), py = calm[1] * (1 - lift), pz = calm[2] * (1 - lift);
      for (let pose = 0; pose < PLAYER_FLAG_POSES; pose++) {
        if (!weights[pose]) continue;
        const point = playerFlagVertex(x, y, pose / PLAYER_FLAG_POSES * Math.PI * 2);
        px += point[0] * weights[pose]!; py += point[1] * weights[pose]!; pz += point[2] * weights[pose]!;
      }
      positions.setXYZ(row * (columns + 1) + column, .032 + px, 1.955 + py, pz);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  };
  update(0);
  return {
    ready: Promise.resolve(),
    createMesh: () => { const mesh = new Mesh(geometry, player); mesh.name = "ship_flag"; return mesh; },
    /** The flag cloth of a ship's livery (absent: the player's own ship). */
    material: (livery?: ShipLivery) => livery ? liveries[livery] : player,
    update,
    dispose: () => {
      geometry.dispose(); weave.dispose(); player.dispose();
      Object.values(liveries).forEach(material => material.dispose());
    }
  };
};
