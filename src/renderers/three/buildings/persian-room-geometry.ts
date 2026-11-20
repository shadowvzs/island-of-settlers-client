import { BufferGeometry, Float32BufferAttribute } from "three";

import type { BuildingPart, Point3 } from "../../../render-common/buildings/building-recipe";
import { PERSIAN_ROOM_INNER_RADIUS } from "../../../render-common/buildings/persian-room-dimensions";
import { persianWindowAngles, persianWindowCrown } from "../../../render-common/buildings/persian-window-profile";

/** Hollow elliptical wall, with a real front opening and closed reveals, contained in the unit box. */
export const createPersianRoomGeometry = (part: BuildingPart, detailed: boolean) => {
  let count = detailed ? 64 : 16;
  if (detailed && part.compactGeometry) count = 32;
  if (!part.occupationRoof && part.radialSegments) count = part.radialSegments;
  const inner = PERSIAN_ROOM_INNER_RADIUS;
  const opening = part.persianOpening ?? [-.22, .22, .3];
  const left = Math.max(-.48, Math.min(.48, opening[0]));
  const right = Math.max(-.48, Math.min(.48, opening[1]));
  const top = Math.max(-.5, Math.min(.5, opening[2]));
  const angles = Array.from({ length: count + 1 }, (_, index) => -Math.PI + Math.PI * 2 * index / count);
  angles.push(Math.asin(left * 2), Math.asin(right * 2), ...persianWindowAngles(part.persianWindows ?? [], detailed));
  const lines = [...new Set(angles)].sort((a, b) => a - b);
  const vaultCap = part.occupationRoof === "barrel", capRatio = part.roofInfillRatio?.[0] ?? 1;
  const capProfile = (x: number) => {
    const columns = part.radialSegments ?? (detailed ? 8 : 4), at = Math.max(0, Math.min(columns, (x + .5) * columns));
    const index = Math.min(columns - 1, Math.floor(at)), share = at - index;
    const first = index / columns - .5, next = (index + 1) / columns - .5;
    return Math.sqrt(Math.max(0, 1 - 4 * first * first)) * (1 - share) +
      Math.sqrt(Math.max(0, 1 - 4 * next * next)) * share;
  };
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const at = (angle: number, radius: number, y: number): Point3 =>
    [Math.sin(angle) * radius, y, Math.cos(angle) * radius];
  const radial = (angle: number, sign = 1): Point3 => [Math.sin(angle) * sign, 0, Math.cos(angle) * sign];
  const face = (points: Point3[], directions: Point3[]) => {
    if (vaultCap) {
      points = points.map(([x, y, z]) => [x, -.5 + (y + .5) *
        capProfile(x * capRatio), z]);
      directions = directions.map((normal, index) => {
        if (normal[1] < .5) return normal;
        const x = points[index]![0] * capRatio;
        const nx = 4 * x * capRatio, ny = Math.sqrt(Math.max(0, 1 - 4 * x * x));
        const length = Math.hypot(nx, ny) || 1;
        return [nx / length, ny / length, 0];
      });
    }
    const start = positions.length / 3;
    points.forEach((point, index) => {
      positions.push(...point); normals.push(...directions[index]!);
      uvs.push(Math.atan2(point[0], point[2]) / Math.PI + .5, point[1] + .5);
    });
    const [a, b, c] = points as [Point3, Point3, Point3, Point3];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    const normal = directions[0]!, correct = cross.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) >= 0;
    if (correct) indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    else indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  };
  const open = (angle: number) => Math.cos(angle) > 0 && Math.sin(angle) * .5 > left && Math.sin(angle) * .5 < right;
  for (let index = 0; index < lines.length - 1; index++) {
    const a = lines[index]!, b = lines[index + 1]!, bottom = open((a + b) / 2) ? top : -.5;
    if (bottom >= .5) continue;
    const na = radial(a), nb = radial(b), ia = radial(a, -1), ib = radial(b, -1);
    const window = part.persianWindows?.find(window => persianWindowCrown(window, (a + b) / 2) !== null);
    if (window && !open((a + b) / 2)) {
      const clamp = (y: number) => Math.max(-.5, Math.min(.5, y));
      const sill = clamp(window.bottom);
      const crownA = clamp(persianWindowCrown(window, a) ?? window.spring);
      const crownB = clamp(persianWindowCrown(window, b) ?? window.spring);
      const strip = (lowA: number, lowB: number, highA: number, highB: number) => {
        if (highA <= lowA && highB <= lowB) return;
        face([at(a, .5, lowA), at(b, .5, lowB), at(b, .5, highB), at(a, .5, highA)], [na, nb, nb, na]);
        face([at(a, inner, lowA), at(b, inner, lowB), at(b, inner, highB), at(a, inner, highA)], [ia, ib, ib, ia]);
      };
      const cap = (ya: number, yb: number, sign: number) => {
        const slope = (yb - ya) / (b - a), middle = (a + b) / 2;
        const normal: Point3 = [-sign * slope * Math.cos(middle), sign * (.5 + inner) / 2,
          sign * slope * Math.sin(middle)];
        const length = Math.hypot(...normal);
        const direction = normal.map(value => value / length) as Point3;
        face([at(a, .5, ya), at(b, .5, yb), at(b, inner, yb), at(a, inner, ya)],
          [direction, direction, direction, direction]);
      };
      strip(-.5, -.5, sill, sill); strip(crownA, crownB, .5, .5);
      if (sill > -.5) cap(-.5, -.5, -1);
      if (Math.min(crownA, crownB) < .5) cap(.5, .5, 1);
      if (window.bottom >= -.5 && window.bottom <= .5) cap(sill, sill, 1);
      if (window.spring + window.rise >= -.5 && window.spring <= .5) cap(crownA, crownB, -1);
      continue;
    }
    face([at(a, .5, bottom), at(b, .5, bottom), at(b, .5, .5), at(a, .5, .5)], [na, nb, nb, na]);
    face([at(a, inner, bottom), at(b, inner, bottom), at(b, inner, .5), at(a, inner, .5)], [ia, ib, ib, ia]);
    face([at(a, .5, .5), at(b, .5, .5), at(b, inner, .5), at(a, inner, .5)],
      [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]]);
    face([at(a, .5, bottom), at(b, .5, bottom), at(b, inner, bottom), at(a, inner, bottom)],
      [[0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]]);
  }
  const jambs = right > left ? [[Math.asin(left * 2), 1], [Math.asin(right * 2), -1]] as const : [];
  for (const [angle, sign] of jambs) {
    const direction: Point3 = [Math.cos(angle) * sign, 0, -Math.sin(angle) * sign];
    face([at(angle, .5, -.5), at(angle, inner, -.5), at(angle, inner, top), at(angle, .5, top)],
      [direction, direction, direction, direction]);
  }
  for (const window of part.persianWindows ?? []) for (const side of [-1, 1]) {
    const angle = window.angle + side * window.halfAngle;
    const low = Math.max(-.5, window.bottom), high = Math.min(.5, window.spring);
    if (high <= low) continue;
    const direction: Point3 = [-side * Math.cos(angle), 0, side * Math.sin(angle)];
    face([at(angle, .5, low), at(angle, inner, low), at(angle, inner, high), at(angle, .5, high)],
      [direction, direction, direction, direction]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};
