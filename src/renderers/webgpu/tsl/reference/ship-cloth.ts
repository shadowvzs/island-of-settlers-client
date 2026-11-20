import {
  SHIP_CLOTH_WIND, shipClothBillowRatio, shipClothFill, shipClothPoint, type ShipClothWindState,
  type ShipClothWindVertex
} from "../../../../render-common/ships/ship-cloth-wind";

/** CPU reference of the TSL ship-cloth offset: `shipClothPoint(position) - position`. */
export const shipClothOffset = (
  position: readonly [number, number, number],
  vertex: ShipClothWindVertex,
  state: ShipClothWindState
): [number, number, number] => {
  const point = shipClothPoint(position, vertex, state);
  return [point[0] - position[0], point[1] - position[1], point[2] - position[2]];
};

const normalize3 = (value: readonly [number, number, number]): [number, number, number] => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};

/** CPU reference of `SHIP_CLOTH_NORMAL_VERTEX`'s bent object normal. */
export const shipClothNormal = (
  position: readonly [number, number, number],
  vertex: ShipClothWindVertex,
  state: ShipClothWindState,
  normal: readonly [number, number, number]
): [number, number, number] => {
  const { flutterCalm, flutterStorm, rippleA, rippleB } = SHIP_CLOTH_WIND;
  const [angle, , flutter, normalShare] = vertex;
  const direction: [number, number, number] = [Math.cos(angle), 0, Math.sin(angle)];
  const fill = shipClothFill(state.localX, state.localZ);
  const ratio = shipClothBillowRatio(state);
  const phase = state.phase;
  const dotWave = (wave: readonly number[]) =>
    position[0]! * wave[1]! + position[1]! * wave[2]! + position[2]! * wave[3]!;
  const argumentA = state.time * rippleA[0]! + dotWave(rippleA) + phase;
  const argumentB = state.time * rippleB[0]! + dotWave(rippleB) + phase * 1.7;
  const amplitude = flutter * (flutterCalm + flutterStorm * state.strength) * (2 - fill);
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  const tangential: [number, number, number] = [
    normal[0] - direction[0] * facing,
    normal[1] - direction[1] * facing,
    normal[2] - direction[2] * facing
  ];
  const slope: [number, number, number] = [0, 1, 2].map(index =>
    amplitude * (Math.cos(argumentA) * rippleA[index + 1]! +
      Math.cos(argumentB) * rippleB[index + 1]! * 0.5) / 1.5) as [number, number, number];
  const slopeAlong = slope[0] * direction[0] + slope[1] * direction[1] + slope[2] * direction[2];
  const tangentSlope: [number, number, number] = [0, 1, 2].map(index =>
    slope[index]! - direction[index]! * slopeAlong) as [number, number, number];
  const share = 1 + normalShare * (ratio - 1);
  const bent: [number, number, number] = [0, 1, 2].map(index =>
    direction[index]! * facing + tangential[index]! * share - facing * tangentSlope[index]!) as
    [number, number, number];
  return normalize3(bent);
};
