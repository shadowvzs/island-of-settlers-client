import { BoxGeometry, CylinderGeometry, Group, type IUniform, Mesh, MeshStandardMaterial, SphereGeometry } from "three";

import type { QualityLevel } from "../../../render-common/quality";
import type { WorkerFrame } from "../../../render-common/workers/worker-unit";
import {
  CHARCOAL_LOG_HALF_LENGTH,
  CHARCOAL_LOG_LAYOUT,
  CHARCOAL_MOUND_CENTER_Y,
  CHARCOAL_MOUND_FULL_SCALE_Y,
  CHARCOAL_MOUND_RADIUS,
  CHARCOAL_SMOKE_START_Y,
  charcoalStageVisual
} from "../../../shared/settlement/charcoal-field";
import type { SettlementFieldFrame } from "../../../shared/settlement/settlement-field-cycles";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";
import { createThreeDrinkCrops } from "./three-drink-crops";
import { createThreeWheatFields } from "./three-wheat-field";

/**
 * Persistent outdoor work sites; cached geometry, no rebuilding during growth or smoke animation.
 * The nation drink crops (vines, rice, hives, palms) need the shared vegetation uniforms; scenes
 * without them (standalone wheat reviews) draw only grain and charcoal.
 */
export const createThreeSettlementFields = (
  world: WorldData, quality: QualityLevel = "high", uniforms?: Record<string, IUniform>
) => {
  const group = new Group(); group.name = "settlement_fields";
  const detailed = quality !== "minimal";
  const wheat = createThreeWheatFields(world, detailed, uniforms);
  const flax = createThreeWheatFields(world, detailed, uniforms, "flax");
  const drinkCrops = uniforms ? createThreeDrinkCrops(world, uniforms, detailed) : null;
  if (drinkCrops) group.add(drinkCrops.group);
  const wheatIds = new Set<number>();
  const flaxIds = new Set<number>();
  const materials = {
    soil: new MeshStandardMaterial({ color: 0x6c5137, roughness: 1 }),
    coal: new MeshStandardMaterial({ color: 0x302c26, roughness: 1 }),
    wood: new MeshStandardMaterial({ color: 0x6b4c2e, roughness: 0.95 }),
    smoke: new MeshStandardMaterial({ color: 0x85817a, transparent: true, opacity: 0.28, depthWrite: false })
  };
  const geometries = {
    soil: new BoxGeometry(0.86, 0.028, 0.86),
    pile: new SphereGeometry(CHARCOAL_MOUND_RADIUS, detailed ? 12 : 6, 5),
    log: new CylinderGeometry(0.065, 0.075, CHARCOAL_LOG_HALF_LENGTH * 2, 6),
    smoke: new SphereGeometry(0.12, 5, 3)
  };
  const sites = new Map<number, { root: Group; logs: Group; pile: Mesh; smoke: Group }>();
  const createCharcoalSite = (frame: SettlementFieldFrame) => {
    const root = new Group(); const logs = new Group(); const smoke = new Group();
    root.position.set(frame.x, sampleSmooth(world, world.heights, frame.x, frame.z) + 0.01, frame.z);
    root.add(new Mesh(geometries.soil, materials.soil), logs, smoke);
    const pile = new Mesh(geometries.pile, materials.soil);
    pile.scale.y = CHARCOAL_MOUND_FULL_SCALE_Y;
    pile.position.y = CHARCOAL_MOUND_CENTER_Y;
    root.add(pile);
    for (const placement of CHARCOAL_LOG_LAYOUT) {
      const log = new Mesh(geometries.log, materials.wood); log.rotation.z = Math.PI / 2;
      log.position.set(0, placement.y, placement.z);
      logs.add(log);
    }
    for (let index = 0; index < 4; index++) smoke.add(new Mesh(geometries.smoke, materials.smoke));
    group.add(root); const site = { root, logs, pile, smoke }; sites.set(frame.id, site); return site;
  };
  const updateCharcoal = (frame: SettlementFieldFrame, time: number) => {
    const site = sites.get(frame.id) ?? createCharcoalSite(frame);
    const visual = charcoalStageVisual(frame.state, frame.step);
    site.logs.visible = visual.logsVisible;
    site.logs.children.forEach((log, index) => { log.visible = visual.logs[index] ?? false; });
    site.pile.visible = visual.moundVisible;
    site.pile.material = visual.coalMaterial ? materials.coal : materials.soil;
    site.pile.scale.y = visual.moundScaleY;
    site.pile.position.y = visual.moundCenterY;
    site.smoke.visible = visual.smokeVisible;
    site.smoke.children.forEach((puff, index) => {
      const age = (time * 0.3 + index / 4) % 1;
      puff.position.set(
        Math.sin(time + index) * age * 0.18,
        CHARCOAL_SMOKE_START_Y + age * 0.75,
        age * 0.1
      );
      puff.scale.setScalar(0.5 + age * 1.7);
    });
  };
  const update = (frames: readonly SettlementFieldFrame[], time: number, workers: readonly WorkerFrame[] = []) => {
    drinkCrops?.update(frames, time, workers);
    const active = new Set(frames.map(frame => frame.id));
    for (const id of wheatIds) if (!active.has(id)) { wheat.remove(id); wheatIds.delete(id); }
    for (const id of flaxIds) if (!active.has(id)) { flax.remove(id); flaxIds.delete(id); }
    for (const [id, site] of sites) if (!active.has(id)) { site.root.removeFromParent(); sites.delete(id); }
    for (const frame of frames) {
      if (frame.kind === "charcoal") updateCharcoal(frame, time);
      if (frame.kind === "flax") {
        const root = flax.update(frame, time);
        if (!root.parent) group.add(root);
        flaxIds.add(frame.id);
        continue;
      }
      if (frame.kind !== "grain") continue;
      const root = wheat.update(frame, time);
      if (!root.parent) group.add(root);
      wheatIds.add(frame.id);
    }
  };
  const dispose = () => {
    group.clear(); sites.clear(); wheat.dispose(); flax.dispose(); wheatIds.clear(); flaxIds.clear();
    drinkCrops?.dispose();
    Object.values(geometries).forEach((geometry) => geometry.dispose());
    Object.values(materials).forEach((material) => material.dispose());
  };
  return { casters: drinkCrops?.casters, group, update, dispose };
};
