import { Group, Mesh, type MeshStandardMaterial } from "three";

import type { BuildingFrame } from "../../../render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { CATAPULT_STONE_DIAMETER } from "../../../render-common/buildings/catapult-mechanism";
import {
  catapultDropStoneShape, catapultRestingStoneLift, type CatapultStoneShape
} from "../../../render-common/buildings/catapult-stone-presentation";
import { WORKER_SCALE } from "../../../render-common/workers/worker-dimensions";
import { createWareModel } from "../settlement/ware-models";
import { markBuildingRuntimeProp } from "./building-runtime-props";
import { tintCatapultObject } from "./catapult-ammo-material";
import { createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial } from "./catapult-rock-geometry";

type GroundStockState = Pick<BuildingFrame, "catapultSupply" | "catapultGroundPoints" | "construction"> &
  Partial<Pick<BuildingFrame, "x" | "y" | "z" | "rotation">>;
interface GroundStoneEntry { hidden: boolean; kind?: import("../../../shared/settlement/catapult-ammo-kinds").CatapultAmmoKind;
  point: { x: number; y: number; z: number }; shape: CatapultStoneShape }
const SLOTS = 6;

/** The carriers' own block geometry, shared by every pile slot, on the building's stone surface. */
const createCarriedBlockSource = (detailed: boolean, materials: Record<BuildingSurface, MeshStandardMaterial>) => {
  const model = createWareModel("stone", detailed, materials, "carry");
  const mesh = model.root.getObjectByName("ware_geometry")!.children.find(child => child instanceof Mesh) as Mesh;
  return { mesh, dispose: model.dispose };
};

/** Delivered entrance-pile stones are blocks; casualty drops keep the shape they were carried in. */
const groundStoneEntries = (state: GroundStockState, scale: number): GroundStoneEntry[] => {
  const supply = state.catapultSupply, porter = supply?.porter;
  const collecting = porter?.phase === "pickup";
  const pile = (state.catapultGroundPoints ?? []).map((point, slot) => ({ kind: supply?.groundKinds?.[slot],
    point, shape: "block" as const,
    hidden: collecting && porter.drop === undefined && slot === (supply?.ground ?? 0) - 1 }));
  const drops = (supply?.drops ?? []).map((point, slot) => {
    const shape = catapultDropStoneShape(point.y, state.y ?? 0, scale);
    return { kind: point.kind, point: { ...point, y: point.y + catapultRestingStoneLift(shape, scale) }, shape,
      hidden: collecting && porter.drop === slot };
  });
  return [...pile, ...drops];
};

/** Finite actual ground deliveries and casualty drops; never a decorative unlimited pile. */
export const createCatapultGroundStock = (
  detailed: boolean, scale: number, materials: Record<BuildingSurface, MeshStandardMaterial>
) => {
  const root = new Group(); root.name = "catapult_ground_stock";
  const block = createCarriedBlockSource(detailed, materials);
  const rockGeometry = createCatapultRockGeometry(detailed), rockMaterial = createCatapultRockMaterial(detailed);
  const addSlotMesh = (name: string, mesh: Mesh) => {
    mesh.name = name; mesh.visible = false; root.add(mesh); return mesh;
  };
  const slots = Array.from({ length: SLOTS }, (_, slot) => {
    // Block world size and yaw match the carrier's set-down exactly, so the hand-off never pops.
    const blockMesh = addSlotMesh(`catapult_ground_block_${slot}`, new Mesh(block.mesh.geometry, block.mesh.material));
    blockMesh.scale.setScalar(WORKER_SCALE / scale);
    blockMesh.castShadow = block.mesh.castShadow; blockMesh.receiveShadow = block.mesh.receiveShadow;
    const round = addSlotMesh(`catapult_ground_round_${slot}`, new Mesh(rockGeometry, rockMaterial));
    round.scale.setScalar(CATAPULT_STONE_DIAMETER); round.rotation.y = slot * 1.83;
    return { block: blockMesh, round };
  });
  markBuildingRuntimeProp(root);
  return {
    root,
    update: (state: GroundStockState) => {
      const entries = groundStoneEntries(state, scale);
      const yaw = state.rotation ?? 0, cosine = Math.cos(yaw), sine = Math.sin(yaw);
      slots.forEach((slot, index) => {
        const entry = entries[index], shown = state.construction === 1 && !!entry && !entry.hidden;
        slot.block.visible = shown && entry.shape === "block";
        slot.round.visible = shown && entry.shape === "round";
        if (shown) tintCatapultObject(slot[entry.shape], entry.kind);
        if (!entry) return;
        const x = (entry.point.x - (state.x ?? 0)) / scale, z = (entry.point.z - (state.z ?? 0)) / scale;
        slot[entry.shape].position.set(x * cosine - z * sine, (entry.point.y - (state.y ?? 0)) / scale,
          z * cosine + x * sine);
      });
    },
    dispose: () => {
      root.removeFromParent(); block.dispose(); rockGeometry.dispose(); disposeCatapultRockMaterial(rockMaterial);
    }
  };
};
