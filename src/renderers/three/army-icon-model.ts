import {
  Box3,
  type BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import { hasDualTomahawks, rangedWeaponStyle } from "../../render-common/workers/military-weapon-style";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createNationShieldIcon, hasNationShieldIcon } from "./army-shield-icon-models";
import { acquireMilitaryEquipment, type MilitaryEquipmentKit, setEquipmentFaction } from "./military-equipment";
import { bowSpan, STRING_Z } from "./military-equipment-bows";
import { meshMaterials } from "./three-mesh-resources";

type IconType = "shield" | "heavy" | "archer";

/** Icons show the issued gear in the traditional heraldic red (the enemy livery slot). */
const issue = (kit: MilitaryEquipmentKit, ...args: Parameters<MilitaryEquipmentKit["create"]>) => {
  const prop = kit.create(...args);
  setEquipmentFaction(prop, 1);
  return prop;
};

/** Icon-only quiver and drawn string; everything it creates is listed for disposal. */
const createArcherSet = (kit: MilitaryEquipmentKit, nation: WorkerNation, owned: Set<BufferGeometry | Material>) => {
  const own = <T extends BufferGeometry | Material>(value: T) => { owned.add(value); return value; };
  const bow = issue(kit, "bow", nation, "archer");
  if (rangedWeaponStyle(nation) !== "bow") {
    bow.userData.updateCrossbow?.(.6);
    bow.rotation.y = -.5;
    if (nation === "chinese") {
      bow.rotation.set(.85, -.35, -.45);
      const line = bow.getObjectByName("crossbow_string") as import("three").Line;
      line.visible = false;
      const cord = own(new MeshStandardMaterial({ color: "#d6c59f", roughness: .95 }));
      const position = line.geometry.getAttribute("position");
      for (const end of [0, 2]) {
        const points = [new Vector3().fromBufferAttribute(position, end),
          new Vector3().fromBufferAttribute(position, 1)];
        bow.add(new Mesh(own(new TubeGeometry(new CatmullRomCurve3(points), 2, .0028, 5, false)), cord));
      }
    }
    if (nation === "maya") {
      bow.rotation.z = -.35;
      bow.scale.set(1.9, 1, 1.9);
    }
    return [bow];
  }
  const draw = new Vector3(0, 0, -.21);
  bow.userData.updateBowString(draw, true);
  bow.getObjectByName("bow_string")!.visible = false;
  // Same drawn-string endpoints as the live bow, with a real thin cord readable in a render.
  const string = own(new MeshStandardMaterial({ color: 0xe9d8ae, roughness: .95 }));
  const { low, tall } = bowSpan(nation);
  bow.add(new Mesh(own(new TubeGeometry(new CatmullRomCurve3([
    new Vector3(0, low, STRING_Z), draw, new Vector3(0, tall, STRING_Z)
  ]), 8, .0028, 5, false)), string));
  bow.rotation.y = Math.PI / 2;
  const angledBow = new Group(); angledBow.rotation.z = -.6;
  angledBow.position.set(.05, .035, .045); angledBow.add(bow);
  if (nation === "persian") {
    angledBow.rotation.z = -.45;
    angledBow.position.set(.085, .065, .06);
  }
  const quiver = new Group(); quiver.position.set(-.125, -.075, -.10); quiver.rotation.z = .24;
  const leather = own(new MeshStandardMaterial({ color: nation === "japanese" ? 0x333134 : 0x785133,
    roughness: .82 }));
  const bronze = own(new MeshStandardMaterial({ color: 0xa99160, roughness: .5, metalness: .6 }));
  const bottom = new Mesh(own(new CylinderGeometry(.036, .036, .012, 16)), leather);
  bottom.position.y = -.14;
  quiver.add(new Mesh(own(new CylinderGeometry(.048, .036, .28, 16, 1, true)), leather), bottom);
  for (const y of [-.13, .14]) {
    const rim = new Mesh(own(new TorusGeometry(y > 0 ? .047 : .036, .004, 6, 20)), bronze);
    rim.rotation.x = Math.PI / 2; rim.position.y = y; quiver.add(rim);
  }
  quiver.add(new Mesh(own(new TubeGeometry(new CatmullRomCurve3([
    new Vector3(-.04, .10, 0), new Vector3(-.072, -.02, -.01), new Vector3(-.03, -.12, 0)
  ]), 10, .006, 5, false)), leather));
  const originalArrow = bow.getObjectByName("nocked_arrow")!;
  for (let index = 0; index < 3; index++) {
    const arrow = originalArrow.clone(true);
    arrow.position.set((index - 1) * .018, .10 + index * .015, -.015);
    arrow.quaternion.identity(); arrow.rotation.z = (index - 1) * .04;
    quiver.add(arrow);
  }
  // Side-by-side objects: their projected silhouettes must not merge into an unreadable knot.
  angledBow.rotation.z = nation === "persian" ? -.32 : -.4;
  angledBow.position.set(0, 0, 0); quiver.position.set(0, 0, 0);
  const bowBounds = new Box3().setFromObject(angledBow), bagBounds = new Box3().setFromObject(quiver);
  angledBow.position.x = .055 - bowBounds.min.x;
  quiver.position.x = -.055 - bagBounds.max.x;
  angledBow.position.y = -(bowBounds.min.y + bowBounds.max.y) / 2;
  quiver.position.y = -(bagBounds.min.y + bagBounds.max.y) / 2;
  return [angledBow, quiver];
};

const createIssuedSet = (kit: MilitaryEquipmentKit, nation: WorkerNation, type: IconType): Object3D[] => {
  if (type === "heavy") {
    const weapon = issue(kit, "axe", nation, type);
    weapon.rotation.z = -.63; weapon.rotation.y = -.15;
    if (nation === "maya") {
      weapon.rotation.set(-.12, .12, -.75);
      weapon.scale.set(1.4, 1, 1.4);
    }
    if (hasDualTomahawks(nation, type)) {
      const offhand = issue(kit, "axe", nation, type);
      weapon.position.x = -.08; offhand.position.x = .08; offhand.rotation.z = .63;
      return [weapon, offhand];
    }
    return [weapon];
  }
  const shield = issue(kit, "shield", nation, type);
  shield.position.set(-.075, 0, .045 - .06); shield.rotation.y = -.15;
  const weapon = issue(kit, "sword", nation, type);
  weapon.position.set(.105, -.07, -.035); weapon.rotation.z = -.52;
  return [weapon, shield];
};

/** Render the exact issued equipment; composites distinguish roles at ordinary 44px UI size. */
export const createArmyIconModel = (nation: WorkerNation, type: IconType) => {
  const root = new Group(); root.name = `army_icon_${nation}_${type}`;
  const kit = acquireMilitaryEquipment(true);
  const owned = new Set<BufferGeometry | Material>();
  const textures = new Set<Texture>();
  if (type === "shield" && hasNationShieldIcon(nation)) {
    const icon = createNationShieldIcon(nation);
    icon.traverse(object => {
      if (!(object instanceof Mesh)) return;
      owned.add(object.geometry);
      meshMaterials(object).forEach(material => owned.add(material));
    });
    for (const texture of icon.userData.localTextures ?? []) textures.add(texture);
    root.add(icon);
  } else if (type === "archer") root.add(...createArcherSet(kit, nation, owned));
  else root.add(...createIssuedSet(kit, nation, type));
  return { root, dispose: () => {
    root.traverse(object => object.userData.disposeOwned?.());
    owned.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
    kit.release(); root.removeFromParent();
  } };
};
