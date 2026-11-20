import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  VectorKeyframeTrack
} from "three";

import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingRecipe } from "../../../render-common/buildings/building-recipe";
import { romanFurnaceAnchors } from "../../../render-common/buildings/roman-furnaces";
import {
  createRomanEmberTexture,
  createRomanFurnaceFire,
  createRomanSmokeTexture,
  romanFurnaceFireTracks,
  updateRomanFurnaceFire
} from "./roman-furnace-fire";

const smokeMotion = (time: number, index: number, count: number) => {
  const phase = (time / 2 + index / count) % 1;
  const fade = Math.min(1, phase * 12, (1 - phase) * 8);
  const radius = (0.055 + phase * 0.16) * Math.max(0.001, fade);
  return {
    position: [
      phase * phase * 0.23 + Math.sin(index * 2 + phase * 6) * phase * 0.05,
      phase * 0.95,
      Math.cos(index * 2 + phase * 4) * phase * 0.07
    ],
    scale: [radius * 1.3, radius * 0.85, radius]
  };
};

/** Small, translucent 3D wisps drift, expand and dissipate above every authored chimney. */
export const createRomanFurnaceEffects = (
  definition: BuildingDefinition,
  recipe: BuildingRecipe,
  detailed: boolean
) => {
  const anchors = romanFurnaceAnchors(definition, recipe);
  if (!anchors) return undefined;
  const root = new Group();
  root.name = "furnace_effects";
  const times = Array.from({ length: 81 }, (_, index) => index / 40);
  const tracks: VectorKeyframeTrack[] = [];
  const name = definition.id === 26 ? "smelter_fire" : "hearth_fire";
  const fire = anchors.fire ? createRomanFurnaceFire(detailed, name) : undefined;
  if (fire && anchors.fire) {
    const holder = new Group();
    holder.position.set(...anchors.fire);
    holder.scale.set(...anchors.size);
    holder.add(fire);
    const embers = new Mesh(
      new BoxGeometry(0.23, 0.012, 0.07),
      new MeshBasicMaterial({ map: createRomanEmberTexture(detailed), toneMapped: false })
    );
    embers.position.set(0, 0.007, -0.025);
    embers.userData.ownedMaterial = true;
    embers.userData.ownedMap = true;
    holder.add(embers);
    root.add(holder);
    tracks.push(...romanFurnaceFireTracks(detailed, name));
  }
  const smoke = new Group();
  smoke.position.set(...anchors.smoke);
  root.add(smoke);
  const count = detailed ? 6 : 3;
  const material = new MeshBasicMaterial({
    map: createRomanSmokeTexture(detailed),
    color: 0xffffff,
    transparent: true,
    opacity: detailed ? 0.5 : 0.4,
    depthWrite: false
  });
  for (let index = 0; index < count; index++) {
    const puff = new Mesh(new SphereGeometry(1, detailed ? 12 : 5, detailed ? 8 : 4), material);
    // Uneven lobes keep smoke from looking like identical solid balls.
    const positions = puff.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const ripple = 1 + Math.sin(positions.getX(vertex) * 8 + index) * 0.16;
      positions.setXYZ(
        vertex,
        positions.getX(vertex) * ripple,
        positions.getY(vertex) * ripple,
        positions.getZ(vertex) * ripple
      );
    }
    puff.geometry.computeVertexNormals();
    puff.name = `chimney_smoke_${index}`;
    if (index === 0) {
      puff.userData.ownedMaterial = true;
      puff.userData.ownedMap = true;
    }
    smoke.add(puff);
    tracks.push(
      new VectorKeyframeTrack(
        `${puff.name}.position`,
        times,
        times.flatMap((time) => smokeMotion(time, index, count).position)
      )
    );
    tracks.push(
      new VectorKeyframeTrack(
        `${puff.name}.scale`,
        times,
        times.flatMap((time) => smokeMotion(time, index, count).scale)
      )
    );
  }
  const update = (time: number, working: boolean) => {
    root.visible = working;
    if (fire) updateRomanFurnaceFire(fire, time);
    smoke.children.forEach((puff, index) => {
      const motion = smokeMotion(time, index, count);
      puff.position.set(...(motion.position as [number, number, number]));
      puff.scale.set(...(motion.scale as [number, number, number]));
    });
  };
  update(0, true);
  return { root, tracks, update };
};
