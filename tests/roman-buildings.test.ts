import { AnimationMixer, Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  BUILDING_CATALOG,
  getBuildingDefinition
} from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { buildingTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { checkTriangleBudget } from "../tools/bench/triangle-budget";

const surfaces: BuildingSurface[] = [
  "mosaic", "rope",
  "paint",
  "plaster",
  "stone",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "amber", "copper", "cut-stone", "bread",
  "roof",
  "iron",
  "steel",
  "cloth",
  "leaf",
  "dark",
  "gold"
];
const materials = Object.fromEntries(
  surfaces.map((surface) => [surface, new MeshStandardMaterial()])
) as Record<BuildingSurface, MeshStandardMaterial>;

describe("original Roman building library", () => {
  it("gives producers six shared output slots without limiting warehouses or foresters", () => {
    for (const id of [17, 18, 19, 21, 22, 25, 26, 31, 32, 33, 35]) {
      const definition = getBuildingDefinition(id);
      expect(definition.outputStorage?.capacity).toBe(6);
      expect(definition.outputStorage?.goods.length).toBeGreaterThan(0);
      const model = createRomanBuilding(definition, materials, false);
      expect(model.root.userData.outputStorage).toEqual(definition.outputStorage);
      model.dispose();
    }
    expect(getBuildingDefinition(24).outputStorage?.goods).toEqual(["shield", "sword", "axe", "bow"]);
    for (const id of [0, 1, 2, 14, 20, 29, 39])
      expect(getBuildingDefinition(id).outputStorage).toBeUndefined();
  });
  it.each(BUILDING_CATALOG.filter((building) => building.style !== "well"))(
    "$name has no sightline through the wall above its closed door",
    (definition) => {
      for (const detailed of [true, false]) {
        const model = createRomanBuilding(definition, materials, detailed);
        model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        const center = model.recipe.door[0] + (model.recipe.doorDimensions?.width ?? 0.46) / 2;
        const front = model.recipe.door[2] - 0.016;
        for (const x of [-0.19, -0.1, 0, 0.1, 0.19])
          for (const y of [0.65, 0.71, 0.76, 0.81, 0.845]) {
            if (model.recipe.doorProfile === "flat" && y > 0.76) continue;
            const ray = new Raycaster(
              new Vector3(center + x, y, front + 0.3),
              new Vector3(0, 0, -1)
            );
            const hits = ray.intersectObjects(model.root.children, true);
            expect(hits[0]?.distance, `door gap: ${definition.name} ${x},${y}`).toBeLessThan(0.4);
          }
        model.dispose();
      }
    }
  );
  it("Metalworks anvil rests on the ground and the hammer reaches its face", () => {
    const model = createRomanBuilding(getBuildingDefinition(25), materials, true);
    const anvil = model.recipe.parts.find((part) => part.shape === "anvil")!;
    expect(anvil.position[1] - anvil.size[1] / 2).toBeLessThan(0.001);
    const handle = model.root.getObjectByName("tool_hammer_handle") as Mesh;
    expect(handle.geometry.type).toBe("CylinderGeometry");
    expect(handle.position.y).toBeGreaterThan(0);
    expect(Math.abs(handle.rotation.z)).toBeGreaterThan(0.5);
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(model.root.animations[2]!).play();
    mixer.setTime(1.5);
    model.root.updateMatrixWorld(true);
    const head = model.root.getObjectByName("tool_hammer_head")!;
    const bottom = new Box3().setFromObject(head).min.y;
    expect(bottom).toBeGreaterThan(0.23);
    expect(bottom).toBeLessThan(0.29);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    model.dispose();
  });
  it.each([14])("building %s balcony door opens onto a genuine wall opening", (id) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed);
      model.update(0, { construction: 1, door: 0, balconyDoor: 0, working: false });
      model.root.updateMatrixWorld(true);
      const leaf = model.root.getObjectByName("balcony_door")!;
      const anchor = model.recipe.balconyDoor;
      const yaw = anchor?.yaw ?? 0;
      const width = anchor?.width ?? 0.35;
      const height = anchor?.height ?? 0.5;
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const point = leaf.position
        .clone()
        .add(new Vector3(width / 2, height / 2, 0).applyAxisAngle(new Vector3(0, 1, 0), yaw));
      const ray = new Raycaster(
        point.clone().addScaledVector(forward, 0.2),
        forward.clone().negate()
      );
      expect(ray.intersectObject(model.root, true)[0]?.distance).toBeLessThan(0.24);
      model.update(0, { construction: 1, door: 0, balconyDoor: 1, working: false });
      model.root.updateMatrixWorld(true);
      expect(leaf.rotation.y).toBeCloseTo(yaw - 1.45);
      expect(ray.intersectObject(model.root, true)[0]?.distance ?? Infinity).toBeGreaterThan(0.35);
      const clip = model.root.animations.find((animation) => animation.name === "door")!;
      expect(clip.tracks.some((track) => track.name === "balcony_door.quaternion")).toBe(true);
      model.dispose();
    }
  });
  it.each([
    [2, 2, 3],
    [4, 3, 6],
    [9, 6, 10]
  ])("military building %s reserves %s supported archer positions", (id, count, garrison) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(getBuildingDefinition(id!), materials, detailed);
      model.update(0, { construction: 1, door: 0, working: false });
      model.root.updateMatrixWorld(true);
      expect(model.recipe.archerPositions).toHaveLength(count!);
      expect(model.root.userData.garrisonCapacity).toBe(garrison!);
      for (const anchor of model.recipe.archerPositions!) {
        const ray = new Raycaster(
          new Vector3(...anchor).add(new Vector3(0, 0.1, 0)),
          new Vector3(0, -1, 0)
        );
        expect(ray.intersectObject(model.root, true)[0]?.distance).toBeCloseTo(0.1, 2);
      }
      model.dispose();
    }
  });
  it("retains the explicit active catalog and reserves removed identities", () => {
    const retained = [...Array.from({ length: 63 }, (_, id) => id)]
      .filter(id => ![30, 38, 44, 48, 52, 56].includes(id));
    expect(BUILDING_CATALOG.map(building => building.id).sort((a, b) => a - b)).toEqual(retained);
    expect(getBuildingDefinition(20).task).toBe("plant");
    expect(getBuildingDefinition(17).task).toBe("fell");
    for (const id of [30, 38, 44, 48, 52, 56, 63])
      expect(() => getBuildingDefinition(id)).toThrow(`Unknown building ID: ${id}`);
    expect(getBuildingDefinition(16).name).toBe("Catapult Tower");
    expect(getBuildingDefinition(7).name).toBe("Monument");
  });
  // The Monument's recipe is collision/plot metadata only; its national GLBs carry the render LODs.
  it.each(BUILDING_CATALOG.filter((building) => building.id !== MONUMENT_TYPE_ID))(
    "$name has finite geometry, bounded LODs and exportable clips",
    (definition) => {
      const high = createRomanBuilding(definition, materials, true);
      const minimal = createRomanBuilding(definition, materials, false);
      expect(minimal.triangles()).toBeLessThan(high.triangles());
      // The asset export's budgets: up to 15 % over only warns (owner 2026-10-20).
      const [highBudget, minimalBudget] = buildingTriangleBudget(definition.id);
      expect(checkTriangleBudget(minimal.triangles(false), minimalBudget)).not.toBe("fail");
      expect(checkTriangleBudget(high.triangles(false), highBudget)).not.toBe("fail");
      const bounds = new Box3().setFromObject(high.root);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1.01);
      expect(bounds.min.y).toBeLessThanOrEqual(definition.id === 39 ? -0.59 : 0.025);
      expect(Number.isFinite(bounds.getSize(new Vector3()).length())).toBe(true);
      expect(high.root.animations.map((clip) => clip.name)).toEqual([
        "construction",
        "door",
        "working",
        ...([0, 1, 2, 4, 9].includes(definition.id) ? ["wind"] : []),
        ...(definition.id === 22 ? ["ambient_empty_cords"] : [])
      ]);
      for (const clip of high.root.animations) {
        for (const track of clip.tracks)
          expect(track.name).toMatch(
            /\.(scale|position|quaternion|morphTargetInfluences\[[0-7]\])$/
          );
      }
      const mixer = new AnimationMixer(high.root);
      mixer.clipAction(high.root.animations[1]!).play();
      mixer.update(0.5);
      // Double-door buildings (HQ, Storehouse, Harbour) swing their left leaf instead of one door.
      const leaf = high.recipe.doubleDoor ? "door_left" : "door";
      expect(high.root.getObjectByName(leaf)!.rotation.y).toBeLessThan(-1);
      mixer.stopAllAction();
      mixer.uncacheRoot(high.root);
      high.dispose();
      minimal.dispose();
    }
  );
  it.each([1, 2])("military building %i has tintable cloth responding to wind while idle", (id) => {
    const model = createRomanBuilding(getBuildingDefinition(id), materials, true);
    const cloth = model.root.getObjectByName("player_flag_cloth") as Mesh;
    const state = {
      construction: 1,
      working: false,
      door: 0,
      playerColor: [0.1, 0.3, 0.9] as [number, number, number],
      windStrength: 1,
      windDirection: 0.7
    };
    model.update(0, state);
    const first = [...cloth.morphTargetInfluences!];
    model.update(0.5, state);
    expect(cloth.morphTargetInfluences).not.toEqual(first);
    expect(cloth.rotation.y).toBeCloseTo(0.7);
    expect((cloth.material as MeshStandardMaterial).color.toArray()).toEqual(state.playerColor);
    model.update(1, { ...state, windStrength: 0 });
    expect(cloth.morphTargetInfluences).toEqual(new Array(8).fill(0));
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(model.root.animations.find((clip) => clip.name === "wind")!).play();
    mixer.update(0.5);
    expect(cloth.morphTargetInfluences!.some(weight=>weight>0)).toBe(true);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    model.dispose();
  });
  it("well has an open stone shaft and a lower/crank/raise cycle", () => {
    const model = createRomanBuilding(getBuildingDefinition(35), materials, true);
    model.root.updateMatrixWorld(true);
    const hits = new Raycaster(new Vector3(0.18, 0.48, 0), new Vector3(0, -1, 0)).intersectObjects(
      model.root.children,
      true
    );
    expect(hits[0]!.point.y).toBeLessThan(0.06);
    const bucket = model.root.getObjectByName("well_bucket")!;
    const wheel = model.root.getObjectByName("well_windlass")!;
    const mixer = new AnimationMixer(model.root);
    const action = mixer.clipAction(model.root.animations[2]!);
    action.play();
    mixer.setTime(0);
    const top = bucket.position.y;
    mixer.setTime(2);
    expect(bucket.position.y).toBeLessThan(top - 0.4);
    mixer.setTime(1.25);
    const firstRotation = wheel.quaternion.clone();
    mixer.setTime(1.5);
    expect(wheel.quaternion.equals(firstRotation)).toBe(false);
    mixer.setTime(13);
    expect(bucket.position.y).toBeCloseTo(top);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    model.dispose();
  });
  it("lookout tower animates both doors and allows separate balcony control", () => {
    const model = createRomanBuilding(getBuildingDefinition(14), materials, true);
    const upper = model.root.getObjectByName("balcony_door")!;
    const lower = model.root.getObjectByName("door")!;
    model.update(0, { construction: 1, working: false, door: 0, balconyDoor: 1 });
    expect(upper.rotation.y).toBeCloseTo(-1.45);
    expect(lower.rotation.y).toBeCloseTo(0);
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(model.root.animations[1]!).play();
    mixer.update(0.5);
    expect(upper.rotation.y).toBeLessThan(-1);
    expect(lower.rotation.y).toBeLessThan(-1);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    model.dispose();
  });
  it("new smelting and tool mechanisms move during production and freeze while idle", () => {
    for (const id of [25, 26]) {
      const model = createRomanBuilding(getBuildingDefinition(id), materials, true);
      const ready = { construction: 1, door: 0, working: true };
      const target = model.root.getObjectByName(id === 25 ? "mechanism" : "bellows_lid")!;
      model.update(0, ready);
      const initial = target.position.y;
      model.update(0.1, ready);
      expect(target.position.y).not.toBeCloseTo(initial, 4);
      const moving = target.position.y;
      model.update(0.2, { ...ready, working: false });
      expect(target.position.y).toBe(moving);
      model.dispose();
    }
  });
  it("smelter fire flickers during work and exports the same motion", () => {
    const model = createRomanBuilding(getBuildingDefinition(26), materials, true);
    const fire = model.root.getObjectByName("smelter_fire")!;
    model.update(0, { construction: 1, door: 0, working: true });
    model.update(0.1, { construction: 1, door: 0, working: true });
    expect(fire.scale.y).not.toBe(1);
    const frozen = fire.scale.y;
    model.update(0.2, { construction: 1, door: 0, working: false });
    expect(fire.scale.y).toBe(frozen);
    expect(
      model.root.animations
        .find((clip) => clip.name === "working")
        ?.tracks.some((track) => track.name === "smelter_fire.scale")
    ).toBe(true);
    model.dispose();
  });
  it.each([25, 26, 32])("hearth %i has depth, work-only smoke and exported motion", (id) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed);
      const effects = model.root.getObjectByName("furnace_effects")!;
      const fire = model.root.getObjectByName(id === 26 ? "smelter_fire" : "hearth_fire")!;
      const smoke = model.root.getObjectByName("chimney_smoke_1")!;
      model.update(0, { construction: 1, door: 0, working: true });
      expect(new Box3().setFromObject(fire).getSize(new Vector3()).z).toBeGreaterThan(0.035);
      const initial = smoke.position.y;
      model.update(0.1, { construction: 1, door: 0, working: true });
      expect(smoke.position.y).toBeGreaterThan(initial);
      const clip = model.root.animations.find((animation) => animation.name === "working")!;
      const mixer = new AnimationMixer(model.root);
      mixer.clipAction(clip).play();
      mixer.setTime(0.6);
      expect(smoke.position.y).toBeGreaterThan(initial);
      mixer.stopAllAction();
      mixer.uncacheRoot(model.root);
      model.update(0.2, { construction: 1, door: 0, working: false });
      expect(effects.visible).toBe(false);
      model.update(0.3, { construction: 0.5, door: 0, working: true });
      expect(effects.visible).toBe(false);
      model.dispose();
    }
  });
  it("every furnace chimney emits smoke during production", () => {
    const definitions = BUILDING_CATALOG.filter((definition) =>
      ["forge", "smelt", "bake", "brew", "burn", "mint"].includes(definition.task)
    );
    for (const definition of definitions) {
      const model = createRomanBuilding(definition, materials, false);
      expect(model.root.getObjectByName("chimney_smoke_0"), definition.name).toBeDefined();
      model.dispose();
    }
  });
  it("bakery hearth is lit only during completed-building production", () => {
    const model = createRomanBuilding(getBuildingDefinition(32), materials, true);
    const mechanism = model.root.getObjectByName("mechanism")!;
    model.update(0, { construction: 1, door: 0, working: false });
    expect(mechanism.visible).toBe(false);
    model.update(0.1, { construction: 1, door: 0, working: true });
    expect(mechanism.visible).toBe(true);
    model.update(0.2, { construction: 0.5, door: 0, working: true });
    expect(mechanism.visible).toBe(false);
    model.dispose();
  });
  it("gives farms more space and recognizable production cues on both LODs", () => {
    expect(getBuildingDefinition(37).footprint).toBeGreaterThan(
      getBuildingDefinition(17).footprint
    );
    for (const detailed of [true, false]) {
      const farm = createRomanBuilding(getBuildingDefinition(37), materials, detailed);
      const woodcutter = createRomanBuilding(getBuildingDefinition(17), materials, detailed);
      expect(farm.recipe.parts.some((part) => part.shape === "scythe-blade")).toBe(true);
      expect(new Set(farm.recipe.parts.filter(part => part.stock?.ware === "grain").map(part => part.stock!.slot)).size).toBe(6);
      expect(woodcutter.recipe.parts.some((part) => part.surface === "bark")).toBe(true);
      expect(woodcutter.recipe.parts.some((part) => part.surface === "endgrain")).toBe(true);
      farm.dispose();
      woodcutter.dispose();
    }
  });
  it("puts village work areas on natural ground without a surrounding stone platform", () => {
    const model = createRomanBuilding(getBuildingDefinition(17), materials);
    expect(model.recipe.door[1]).toBe(0);
    expect(model.recipe.workerExit[1]).toBe(0);
    const footings = model.recipe.parts.filter(
      (part) => part.stage === 0 && part.surface === "stone"
    );
    expect(footings).toHaveLength(0);
    for (const footing of footings)
      expect(Math.min(footing.size[0], footing.size[2])).toBeLessThan(0.15);
    const logs = model.recipe.parts.filter((part) => part.surface === "bark" && part.rotation);
    expect(logs.some((part) => Math.abs(part.position[1] - part.size[0] / 2) < 0.001)).toBe(true);
    model.dispose();
  });
  it("uses authoritative construction and freezes mechanisms when work is paused", () => {
    const model = createRomanBuilding(getBuildingDefinition(31), materials);
    const ready = { construction: 1, door: 0.8, working: true };
    model.update(0, ready);
    model.update(0.1, ready);
    const mechanism = model.root.getObjectByName("mechanism")!;
    expect(mechanism.rotation.z).toBeGreaterThan(0);
    const angle = mechanism.rotation.z;
    model.update(0.2, { ...ready, working: false });
    expect(mechanism.rotation.z).toBe(angle);
    model.update(0.3, { ...ready, construction: 0.3 });
    expect(mechanism.visible).toBe(false);
    expect(model.root.getObjectByName("construction_0")!.visible).toBe(true);
    expect(model.root.getObjectByName("construction_4")!.visible).toBe(false);
    model.dispose();
  });
});

it("fishery net has exactly three tall grounded poles in a non-collinear layout", () => {
  const model = createRomanBuilding(getBuildingDefinition(18), materials, true);
  const poles = model.recipe.parts.filter((part) => part.surface === "bark" && part.size[1] > 1);
  expect(poles).toHaveLength(3);
  const [a, b, c] = poles.map((p) => p.position);
  const area = Math.abs((b![0] - a![0]) * (c![2] - a![2]) - (b![2] - a![2]) * (c![0] - a![0]));
  expect(area).toBeGreaterThan(0.5);
  expect(model.recipe.parts.filter((p) => p.surface === "rope").length).toBeGreaterThan(100);
  model.dispose();
});

it("keeps six exposed mineral sack outputs under each ore mine's sorting shelter", () => {
  for (const id of [11, 12, 13]) {
    for (const detailed of [false, true]) {
      const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed);
      const sacks = model.recipe.parts.filter((part) => part.shape === "open-sack");
      expect(sacks).toHaveLength(6);
      for (const sack of sacks) {
        expect(sack.position[0]).toBeGreaterThan(0.5);
        expect(sack.position[0]).toBeLessThan(1.2);
        expect(sack.position[2]).toBeLessThan(0.1);
        expect(sack.position[1] - sack.size[1] / 2).toBeCloseTo(0);
        expect(sack.surface).toBe("sacking");
      }
      model.dispose();
    }
  }
});
