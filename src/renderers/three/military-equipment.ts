import {
  BufferGeometry,
  type ColorRepresentation,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  Mesh,
  type Object3D,
  SRGBColorSpace,
  Vector3
} from "three";

import { type RangedWeaponStyle,rangedWeaponStyle } from "../../render-common/workers/military-weapon-style";
import { DEFAULT_WORKER_COLOR, getWorkerColorHex } from "../../render-common/workers/worker-colors";
import { isBuildingFirstNation } from "../../render-common/workers/worker-nation";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { paintEquipmentAtlas } from "./military-equipment-atlas";
import { buildBlade } from "./military-equipment-blades";
import { bowSpan, buildArrow, buildBow, STRING_Z } from "./military-equipment-bows";
import { createEquipmentMaterial } from "./military-equipment-material";
import { buildShield } from "./military-equipment-shields";
import { buildTwoHanded } from "./military-equipment-two-handed";
import { buildExpansionMelee } from "./military-expansion-melee";
import { buildChineseCrossbow, buildCrossbowBolt, buildExpansionBow, buildMayaJavelin, CROSSBOW } from "./military-expansion-ranged";
import { buildExpansionShield } from "./military-expansion-shields";
import { crossbowLoadState } from "./worker-crossbow-pose";

/**
 * Issued nation equipment of the soldiers (owner decision 2026-10-12): each nation carries the
 * shield and weapons of its army icon. One shared kit per detail level holds a geometry per item,
 * one painted atlas and two materials (player livery, enemy red), so every soldier's item is a
 * single draw call of shared GPU data, whatever the army size.
 */
const MILITARY_EQUIPMENT = ["axe", "bow", "shield", "sword"] as const;
export type MilitaryEquipmentId = (typeof MILITARY_EQUIPMENT)[number];
export const isMilitaryEquipment = (id: string): id is MilitaryEquipmentId =>
  (MILITARY_EQUIPMENT as readonly string[]).includes(id);

/** Hostile factions' tunic and shield livery. */
export const ENEMY_LIVERY = 0xa8382d;
let playerLivery: ColorRepresentation = getWorkerColorHex(DEFAULT_WORKER_COLOR);

const BLADE_AXES = { blade: new Vector3(0, 1, 0), edge: new Vector3(1, 0, 0) };
const SHIELD_AXES = { face: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) };

const createAtlas = (detailed: boolean) => {
  const size = detailed ? 512 : 256;
  const atlas = new DataTexture(new Uint8Array(paintEquipmentAtlas(size).buffer), size, size);
  atlas.colorSpace = SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.anisotropy = detailed ? 4 : 1;
  atlas.needsUpdate = true;
  return atlas;
};

/** The geometry of one item; swords split by the troop that carries them. */
const itemGeometry = (id: MilitaryEquipmentId, nation: WorkerNation, type: MilitaryTroopType,
  detailed: boolean, ranged?: RangedWeaponStyle) => {
  if (id === "bow" && ranged === "bow" && (nation === "chinese" || nation === "maya"))
    return buildBow("roman", detailed);
  if (isBuildingFirstNation(nation)) {
    if (id === "shield") return buildExpansionShield(nation, detailed);
    if (id === "axe") return buildExpansionMelee(nation, "twoHanded", detailed);
    if (id === "sword") return buildExpansionMelee(nation, type === "cavalry" ? "cavalry" : "infantry", detailed);
    if (nation === "chinese") return buildChineseCrossbow(detailed);
    if (nation === "maya") return buildMayaJavelin(detailed);
    return buildExpansionBow(nation, detailed);
  }
  if (id === "shield") return buildShield(nation, detailed);
  // The heavy troop's tool id is "axe"; its weapon is the nation's two-handed one.
  if (id === "axe") return buildTwoHanded(nation, detailed);
  if (id === "bow") return buildBow(nation, detailed);
  return buildBlade(nation, type === "cavalry" ? "cavalry" : "infantry", detailed);
};

const createKit = (detailed: boolean) => {
  const atlas = createAtlas(detailed);
  const player = createEquipmentMaterial(atlas, playerLivery), enemy = createEquipmentMaterial(atlas, ENEMY_LIVERY);
  const stringMaterial = new LineBasicMaterial({ color: 0xd2c3a5 });
  const geometries = new Map<string, BufferGeometry>();
  const shared = (key: string, build: () => BufferGeometry) => {
    let geometry = geometries.get(key);
    if (!geometry) geometries.set(key, geometry = build());
    return geometry;
  };
  const meshOf = (geometry: BufferGeometry) => new Mesh(geometry, player.material);

  const stringCrossbow = (root: Group) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      -CROSSBOW.halfSpan, .03, CROSSBOW.limbZ, 0, .03, CROSSBOW.stringDraw,
      CROSSBOW.halfSpan, .03, CROSSBOW.limbZ
    ], 3));
    const string = new Line(geometry, stringMaterial); string.name = "crossbow_string";
    const bolt = meshOf(shared("crossbow-bolt", () => buildCrossbowBolt(detailed)));
    bolt.name = "loaded_bolt"; bolt.rotation.x = Math.PI / 2; bolt.position.set(0, .064, .015);
    root.add(string, bolt);
    root.userData.updateCrossbow = (progress: number | null) => {
      const state = crossbowLoadState(progress), position = geometry.getAttribute("position");
      position.setXYZ(1, 0, .03, CROSSBOW.limbZ + (CROSSBOW.stringDraw - CROSSBOW.limbZ) * state.tension);
      position.needsUpdate = true; geometry.computeBoundingSphere(); bolt.visible = state.bolt;
    };
    root.userData.updateCrossbow(null);
    root.userData.disposeOwned = () => geometry.dispose();
  };

  /** Bow string (own line per archer) and the nocked arrow that follows the drawing hand. */
  const stringBow = (root: Group, nation: WorkerNation) => {
    const { low, tall } = bowSpan(nation);
    const stringGeometry = new BufferGeometry();
    stringGeometry.setAttribute("position", new Float32BufferAttribute([0, low, STRING_Z, 0, 0, STRING_Z,
      0, tall, STRING_Z], 3));
    const bowString = new Line(stringGeometry, stringMaterial);
    bowString.name = "bow_string";
    const arrow = meshOf(shared("arrow", () => buildArrow(detailed)));
    arrow.name = "nocked_arrow";
    root.add(bowString, arrow);
    const direction = new Vector3(), up = new Vector3(0, 1, 0);
    root.userData.updateBowString = (contact: Vector3, draw: boolean) => {
      const position = stringGeometry.getAttribute("position");
      position.setXYZ(1, contact.x, contact.y, contact.z);
      position.needsUpdate = true;
      stringGeometry.computeBoundingSphere();
      direction.set(0, 0, 0).sub(contact).normalize();
      arrow.position.copy(contact).addScaledVector(direction, .2);
      arrow.quaternion.setFromUnitVectors(up, direction);
      arrow.visible = draw;
    };
    root.userData.disposeOwned = () => stringGeometry.dispose();
  };

  const create = (id: MilitaryEquipmentId, nation: WorkerNation, type: MilitaryTroopType,
    ranged?: RangedWeaponStyle) => {
    const root = new Group();
    root.name = `military_${id}`;
    const key = `${id}:${nation}:${id === "sword" && type === "cavalry" ? "cavalry" : ""}:${ranged ?? ""}`;
    root.add(meshOf(shared(key, () => itemGeometry(id, nation, type, detailed, ranged))));
    root.userData = { localTextures: [], sharedEquipment: true };
    if (id === "shield") root.userData.shieldAxes = SHIELD_AXES;
    else if (id !== "bow") root.userData.meleeAxes = BLADE_AXES;
    if (id === "bow") {
      const style = ranged ?? rangedWeaponStyle(nation);
      root.userData.rangedWeapon = style;
      if (style === "crossbow") stringCrossbow(root);
      else if (style === "bow") stringBow(root, nation);
      else root.userData.meleeAxes = BLADE_AXES;
    }
    let wornFaction = 0;
    root.userData.setFaction = (faction: number) => {
      if (faction === wornFaction) return;
      wornFaction = faction;
      root.traverse(object => {
        if (object instanceof Mesh) object.material = faction ? enemy.material : player.material;
      });
    };
    return root;
  };
  return {
    create,
    dispose: () => {
      for (const geometry of geometries.values()) geometry.dispose();
      atlas.dispose();
      player.material.dispose();
      enemy.material.dispose();
      stringMaterial.dispose();
    },
    refs: 0,
    setPlayerLivery: player.setLivery
  };
};

const kits = new Map<boolean, ReturnType<typeof createKit>>();

/** Shares the armoury of one detail level; release it when the owning layer is disposed. */
export const acquireMilitaryEquipment = (detailed: boolean) => {
  const kit = kits.get(detailed) ?? createKit(detailed);
  kits.set(detailed, kit);
  kit.refs++;
  let released = false;
  return {
    create: kit.create,
    release: () => {
      if (released) return;
      released = true;
      kit.refs--;
      if (kit.refs > 0) return;
      kit.dispose();
      kits.delete(detailed);
    }
  };
};
export type MilitaryEquipmentKit = ReturnType<typeof acquireMilitaryEquipment>;

/** The player's colour on shields and grips (Settings > Workers tunic colour). */
export const setMilitaryLiveryColor = (color: ColorRepresentation) => {
  playerLivery = color;
  for (const kit of kits.values()) kit.setPlayerLivery(color);
};

/** Faction 0 wears the player's livery, every other faction the enemy red. */
export const setEquipmentFaction = (prop: Object3D, faction: number) => prop.userData.setFaction?.(faction);

/** A kit prop's GPU data is shared: only its own bow string is released with it. */
export const releaseEquipmentProp = (prop: Object3D) => {
  prop.userData.disposeOwned?.();
  prop.removeFromParent();
};
