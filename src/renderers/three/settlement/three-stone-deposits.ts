import { Group, Mesh, type RawShaderMaterial } from "three";

import {
  buildDepositClusterMesh, createDepositRockTerrain, depositSizeState, STONE_DEPOSIT_TINTS
} from "../../../render-common/rocks/stone-deposit-cluster";
import type { ColonyStone } from "../../../shared/world/colony-resource-tiers";
import { displayFogAt } from "../../../shared/world/fog-display";
import type { MarbleDeposit } from "../../../shared/world/marble-deposit";
import { FOG, type WorldData } from "../../../shared/world/world-data";
import { createStoneGrowIn } from "../three-rock-growth";
import { toRockGeometry } from "../three-rocks";
import { STONE_DEPOSIT_DETAIL_GLSL } from "./stone-material-detail";

interface SourceMesh {
  key: string;
  mesh: Mesh;
}

/**
 * Stone material deposits as quarry stone boulder clusters in the rock shader, one shared material per
 * stone (recoloured). A cluster is rebuilt only when its material, place or size state changes. Like a
 * quarry boulder, a worked out deposit is gone and grows back in when it respawns.
 */
export const createThreeStoneDeposits = (
  world: WorldData,
  low: boolean,
  createTintedMaterial: (tint: readonly [number, number, number], detail?: string,
    family?: string) => RawShaderMaterial
) => {
  const root = new Group();
  const terrain = createDepositRockTerrain(world);
  const materials = new Map<ColonyStone, RawShaderMaterial>();
  const sources = new Map<number, SourceMesh>();
  /** Deposits seen worked out: their return grows in (a deposit first seen full just appears). */
  const resting = new Set<number>();
  const growIn = createStoneGrowIn();
  const materialFor = (stone: ColonyStone) => {
    let material = materials.get(stone);
    if (!material) {
      material = createTintedMaterial(STONE_DEPOSIT_TINTS[stone],
        STONE_DEPOSIT_DETAIL_GLSL[stone], stone);
      materials.set(stone, material);
    }
    return material;
  };
  const removeSource = (id: number) => {
    const source = sources.get(id);
    if (!source) return;
    source.mesh.removeFromParent();
    source.mesh.geometry.dispose();
    sources.delete(id);
  };
  const syncSource = (deposit: MarbleDeposit) => {
    if (deposit.remaining <= 0) {
      removeSource(deposit.id);
      resting.add(deposit.id);
      return;
    }
    const stone = deposit.material ?? "marble";
    const key = `${stone}/${deposit.x}/${deposit.z}/${depositSizeState(deposit.remaining)}/${world.terrainRevision ?? 0}`;
    let source = sources.get(deposit.id);
    if (source?.key !== key) {
      removeSource(deposit.id);
      const geometry = toRockGeometry(buildDepositClusterMesh(deposit, world.seed, terrain, low));
      source = { key, mesh: new Mesh(geometry, materialFor(stone)) };
      source.mesh.name = `${stone}_deposit_${deposit.id}`;
      root.add(source.mesh);
      sources.set(deposit.id, source);
      if (resting.delete(deposit.id)) growIn.track([source.mesh], {
        x: deposit.x, y: terrain.height(deposit.x, deposit.z), z: deposit.z
      });
    }
    const cell = Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x);
    source.mesh.visible = !world.fog || displayFogAt(world, cell) >= FOG.discovered;
  };
  const update = (deposits: readonly MarbleDeposit[], time: number) => {
    const active = new Set(deposits.map(deposit => deposit.id));
    for (const id of sources.keys()) if (!active.has(id)) removeSource(id);
    for (const deposit of deposits) syncSource(deposit);
    growIn.update(time);
  };
  const dispose = () => {
    for (const id of sources.keys()) removeSource(id);
    for (const material of materials.values()) material.dispose();
    materials.clear();
  };
  return { dispose, root, update };
};
