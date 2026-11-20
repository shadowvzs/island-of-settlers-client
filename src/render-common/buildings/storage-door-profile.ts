import type { Point3 } from "./building-recipe";

/** Two opposing civilian lanes use the original building scale and doorway centre. */
export const STORAGE_DOUBLE_DOOR = Object.freeze({ leafDepth: .06, width: .76 });

export const usesStorageDoubleDoor = (typeId: number) => typeId === 0 || typeId === 29 || typeId === 39;
/** Seat a slender jamb/corner trim beside the aperture, retaining its complete section and material. */
export const seatStorageDoorJamb = (position: Point3, size: Point3,
  door: { left: number; right: number; z: number }): Point3 => {
  if (Math.abs(position[2] - door.z) > .2 || size[0] > .2 || size[2] > .2) return position;
  const left = position[0] - size[0] / 2, right = position[0] + size[0] / 2;
  if (right <= door.left || left >= door.right) return position;
  const center = (door.left + door.right) / 2;
  const x = position[0] < center ? door.left - size[0] / 2 - .005 : door.right + size[0] / 2 + .005;
  return [x, position[1], position[2]];
};
