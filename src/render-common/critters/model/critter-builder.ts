import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { cross, dot } from "../../props/mesh-builder";

/**
 * Vertex colour of a loft point: `along` 0 (first station) .. 1 (last), `up` the ring direction's
 * up share (1 on top .. -1 below) and `side` its left share (+1 left .. -1 right).
 */
export type Paint = (along: number, up: number, side: number) => Vec3;

/** One ring of a loft: centre, half width (left / right) and half height (up / down). */
export interface LoftStation {
  at: Vec3;
  height: number;
  /** Reference up of the ring frame (default: the dorsal side of a spine in the side plane). */
  up?: Vec3;
  width: number;
}

export interface LoftOptions {
  /** Close the first / last ring with a point this far beyond it along the tube (0: flat). */
  endTip?: number;
  paint: Paint;
  sides: number;
  startTip?: number;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, amount: number): Vec3 => [
  a[0] * amount,
  a[1] * amount,
  a[2] * amount
];
export const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Point turned about the z axis (pitch in the side plane, positive lifts +x) around `pivot`. */
export const pitchAbout = (point: Vec3, pivot: Vec3, angle: number): Vec3 => {
  const local = sub(point, pivot);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(pivot, [local[0] * cos - local[1] * sin, local[0] * sin + local[1] * cos, local[2]]);
};

/** Point turned about the y axis (yaw, positive turns +x towards +z: to the left). */
export const yawAbout = (point: Vec3, pivot: Vec3, angle: number): Vec3 => {
  const local = sub(point, pivot);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(pivot, [local[0] * cos - local[2] * sin, local[1], local[0] * sin + local[2] * cos]);
};

/** Point turned about the x axis (roll, positive lifts +z) around `pivot`. */
export const rollAbout = (point: Vec3, pivot: Vec3, angle: number): Vec3 => {
  const local = sub(point, pivot);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(pivot, [local[0], local[1] * cos - local[2] * sin, local[1] * sin + local[2] * cos]);
};

/**
 * Default ring up: the tangent turned a quarter up in the side plane (a level body's back, a
 * rising neck's nape, a hanging leg's front), so spines bending in that plane never flip.
 */
const getDorsal = (tangent: Vec3): Vec3 => {
  const planar = Math.hypot(tangent[0], tangent[1]);
  if (planar < 0.2) return [0, 1, 0];
  return [-tangent[1] / planar, tangent[0] / planar, 0];
};

const getRingFrame = (tangent: Vec3, reference: Vec3) => {
  const side = unit(cross(tangent, reference));
  return { side, up: cross(side, tangent) };
};

/**
 * Collects an indexed, smooth shaded critter mesh in world units (forward +x, up +y, left +z,
 * the feet or the water line at y 0). Every builder call adds the same vertices whatever the
 * pose, so all poses of one species share their topology (Three morphs between them).
 */
export class CritterBuilder {
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly positions: number[] = [];

  get vertexCount() {
    return this.positions.length / 3;
  }

  vertex(point: Vec3, color: Vec3) {
    this.positions.push(point[0], point[1], point[2]);
    this.colors.push(color[0], color[1], color[2]);
    return this.vertexCount - 1;
  }

  private point(index: number): Vec3 {
    return [
      this.positions[index * 3]!,
      this.positions[index * 3 + 1]!,
      this.positions[index * 3 + 2]!
    ];
  }

  /** A triangle wound so that its geometric normal points along `outward`. */
  triangle(a: number, b: number, c: number, outward: Vec3) {
    const [pa, pb, pc] = [this.point(a), this.point(b), this.point(c)];
    if (dot(cross(sub(pb, pa), sub(pc, pa)), outward) >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /** A quad (a b c d around its rim) as two triangles facing `outward`. */
  quad(a: number, b: number, c: number, d: number, outward: Vec3) {
    this.triangle(a, b, c, outward);
    this.triangle(a, c, d, outward);
  }

  /**
   * A tube through the stations (body, neck, limb, bill): rings of `sides` shared vertices,
   * optionally closed by a tip point at either end.
   */
  loft(stations: readonly LoftStation[], options: LoftOptions) {
    const { paint, sides } = options;
    const last = stations.length - 1;
    const rings = stations.map((station, index) => {
      const previous = stations[Math.max(0, index - 1)]!.at;
      const next = stations[Math.min(last, index + 1)]!.at;
      const tangent = unit(sub(next, previous));
      const frame = getRingFrame(tangent, station.up ?? getDorsal(tangent));
      const along = last === 0 ? 0 : index / last;
      return Array.from({ length: sides }, (_, side) => {
        const angle = (side / sides) * Math.PI * 2;
        const up = Math.cos(angle);
        const left = Math.sin(angle);
        const offset = add(
          scale(frame.up, up * station.height),
          scale(frame.side, left * station.width)
        );
        return this.vertex(add(station.at, offset), paint(along, up, left));
      });
    });
    for (let ring = 0; ring < last; ring += 1)
      this.joinRings(rings[ring]!, rings[ring + 1]!, stations[ring]!.at);
    this.capRing(rings[0]!, stations, 0, options.startTip ?? 0, paint);
    this.capRing(rings[last]!, stations, last, options.endTip ?? 0, paint);
  }

  private joinRings(first: number[], second: number[], centre: Vec3) {
    for (let side = 0; side < first.length; side += 1) {
      const next = (side + 1) % first.length;
      const outward = sub(this.point(first[side]!), centre);
      this.quad(first[side]!, first[next]!, second[next]!, second[side]!, outward);
    }
  }

  private capRing(
    ring: number[],
    stations: readonly LoftStation[],
    index: number,
    tip: number,
    paint: Paint
  ) {
    const last = stations.length - 1;
    const inner = stations[index === 0 ? Math.min(1, last) : Math.max(0, last - 1)]!.at;
    const centre = stations[index]!.at;
    const direction = unit(sub(centre, inner));
    const apex = this.vertex(add(centre, scale(direction, tip)), paint(index === 0 ? 0 : 1, 0, 0));
    for (let side = 0; side < ring.length; side += 1) {
      this.triangle(apex, ring[side]!, ring[(side + 1) % ring.length]!, direction);
    }
  }

  /** Ellipsoid along `axis` (unit vector; along 0 at the back), radii along / up / side. */
  ellipsoid(centre: Vec3, axis: Vec3, radii: Vec3, paint: Paint, rings = 4, sides = 8, up?: Vec3) {
    const stations: LoftStation[] = [];
    for (let ring = 1; ring < rings; ring += 1) {
      const t = (ring / rings) * 2 - 1;
      const round = Math.sqrt(1 - t * t);
      const at = add(centre, scale(axis, t * radii[0]));
      stations.push({ at, height: radii[1] * round, up, width: radii[2] * round });
    }
    const tip = radii[0] * (2 / rings);
    this.loft(stations, { endTip: tip, paint, sides, startTip: tip });
  }

  /** A flat sheet from rows of points (wings, fins, tails): one side, the shaders light both. */
  sheet(
    rows: readonly (readonly Vec3[])[],
    color: (row: number, column: number) => Vec3,
    outward: Vec3
  ) {
    const ids = rows.map((row, rowIndex) =>
      row.map((point, column) => this.vertex(point, color(rowIndex, column)))
    );
    for (let row = 0; row < ids.length - 1; row += 1) {
      for (let column = 0; column < ids[row]!.length - 1; column += 1) {
        const [a, b] = [ids[row]![column]!, ids[row]![column + 1]!];
        const [c, d] = [ids[row + 1]![column + 1]!, ids[row + 1]![column]!];
        this.quad(a, b, c, d, outward);
      }
    }
  }

  /** Smooth normals: area weighted face normals summed per vertex. */
  private computeNormals() {
    const normals = new Float32Array(this.positions.length);
    for (let index = 0; index < this.indices.length; index += 3) {
      const corners = [this.indices[index]!, this.indices[index + 1]!, this.indices[index + 2]!];
      const [pa, pb, pc] = corners.map((corner) => this.point(corner)) as [Vec3, Vec3, Vec3];
      const normal = cross(sub(pb, pa), sub(pc, pa));
      for (const corner of corners)
        for (let axis = 0; axis < 3; axis += 1) normals[corner * 3 + axis]! += normal[axis]!;
    }
    for (let offset = 0; offset < normals.length; offset += 3) {
      const length = Math.hypot(normals[offset]!, normals[offset + 1]!, normals[offset + 2]!) || 1;
      for (let axis = 0; axis < 3; axis += 1) normals[offset + axis]! /= length;
    }
    return normals;
  }

  finish(): PropMesh {
    const positions = Float32Array.from(this.positions);
    let height = 0.01;
    let radius = 0.01;
    for (let index = 0; index < positions.length; index += 3) {
      height = Math.max(height, positions[index + 1]!);
      radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
    }
    return {
      colors: Float32Array.from(this.colors),
      height,
      indices: Uint16Array.from(this.indices),
      normals: this.computeNormals(),
      positions,
      radius,
      uvs: new Float32Array(this.vertexCount * 2).fill(-1),
      wind: new Float32Array(this.vertexCount * 2)
    };
  }
}

/** Paint of one flat colour. */
export const flat =
  (color: Vec3): Paint =>
  () =>
    color;

/** Upper colour on top blending into the lower one below (countershading). */
export const countershade =
  (upper: Vec3, lower: Vec3, line = 0, softness = 0.35): Paint =>
  (_, up) => {
    const amount = Math.min(1, Math.max(0, (line - up) / softness + 0.5));
    return lerp3(upper, lower, amount);
  };

/** Hash noise of a point (-1..1): vertex mottling, deterministic. */
export const speckle = (a: number, b: number, c: number) => {
  const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43_758.545;
  return (value - Math.floor(value)) * 2 - 1;
};
