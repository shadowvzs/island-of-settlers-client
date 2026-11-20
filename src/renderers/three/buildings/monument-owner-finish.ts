import { type BufferGeometry, Group, Mesh, PlaneGeometry, Vector3 } from "three";

import type { SettlerNation } from "../../../render-common/workers/worker-nation";

const VIKING_GROUND_SLABS = new Set(["Courtyardpaving", "Courtyardstone", "Foundationstone"]);

/** Correct only identified architectural pieces; actual footings, steps and door leaves remain. */
export const finishMonumentArchitecture = (root: Group, nation: SettlerNation) => {
  const owned: BufferGeometry[] = [], remove: Mesh[] = [];
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    // GLTFLoader sanitizes dots from authored node names; compare the exact semantic identity.
    const name = object.name.replace(/[._]/g, "");
    if (nation === "viking" && VIKING_GROUND_SLABS.has(name)) remove.push(object);
    if (nation !== "roman" || name !== "Architecturerecess") return;
    // This authored mesh is solely the entrance's shallow dark backing, not its solid door leaves.
    // One recessed face avoids alpha accumulating on the front and back of the old closed box.
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox!;
    const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    const geometry = new PlaneGeometry(size.x, size.y);
    geometry.translate(centre.x, centre.y, centre.z - .03);
    object.geometry = geometry; owned.push(geometry);
    object.userData.openingShadow = true;
    object.castShadow = false; object.receiveShadow = false;
  });
  for (const object of remove) object.removeFromParent();
  return owned;
};
