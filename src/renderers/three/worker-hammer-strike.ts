import { type Object3D,Quaternion, Vector3 } from "three";

// The original pack head spans X; its build clip swings the Y shaft in the Y/Z plane.
// Turn around the shaft so an end face follows that swing, without moving the grip.
const faceTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);

export const orientWorkingHammer = (hammer: Object3D) => {
  hammer.quaternion.multiply(faceTurn);
};
