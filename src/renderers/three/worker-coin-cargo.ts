import type { Object3D } from "three";

/** Full-size transport loads sit above the waist, inside the original arms' reachable cradle. */
export const placeCarriedCoinCargo = (prop: Object3D) => {
  prop.position.set(0, .70, .36);
  prop.quaternion.identity();
};
