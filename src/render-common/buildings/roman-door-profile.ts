import type { AddPart } from "./roman-resource-workshops";

export const ROMAN_ARCHED_DOOR_IDS = [1, 2, 10, 11, 12, 13, 14, 17, 20, 21, 22, 25, 26, 31, 32, 33];
export const ROMAN_DOOR_WIDTH = 0.46;
const ROMAN_DOOR_SPRING = 0.63;
const ROMAN_FLAT_DOOR_HEIGHT = 0.77;
export interface RomanDoorDimensions { width: number; spring: number; height: number }
export const DEFAULT_ROMAN_DOOR: RomanDoorDimensions = {
  width: ROMAN_DOOR_WIDTH, spring: ROMAN_DOOR_SPRING, height: ROMAN_FLAT_DOOR_HEIGHT
};
export const romanDoorTop = (x: number, arched: boolean, dimensions = DEFAULT_ROMAN_DOOR) => {
  if (!arched) return dimensions.height;
  const radius = dimensions.width / 2;
  const offset = x - radius;
  return dimensions.spring + Math.sqrt(Math.max(0, radius ** 2 - offset ** 2));
};
/** Masonry above each quarter arch closes the corners without cutting across the curved door. */
export const addRomanDoorSpandrels = (part: AddPart, entry: number, front: number, dimensions = DEFAULT_ROMAN_DOOR) => {
  const radius = dimensions.width / 2;
  for (const side of [-1, 1])
    part(
      "stone",
      [
        entry + (side * radius) / 2,
        0.18 + dimensions.spring + radius / 2,
        front
      ],
      [radius, radius, 0.11],
      1,
      "arch-spandrel",
      [0, side === -1 ? Math.PI : 0, 0]
    );
};
