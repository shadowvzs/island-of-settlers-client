import { BufferGeometry, Color, Float32BufferAttribute, SRGBColorSpace, Vector3 } from "three";

import type { BotanicalBlade, BotanicalFan, BotanicalFruit, BotanicalPoint, BotanicalTube } from
  "../../../render-common/plants/catalog-orchard-graph";

export interface BotanicalSurface {
  positions: number[];
  colours: number[];
  uvs: number[];
  indices: number[];
  tubeSeams: [number, number][];
}
export const createBotanicalSurface = (): BotanicalSurface => ({ positions: [], colours: [], uvs: [], indices: [], tubeSeams: [] });
const vertex = (surface: BotanicalSurface, point: Vector3, shade = 1, u = 0, v = 0,
  colour: BotanicalPoint = [1, 1, 1]) => {
  const id = surface.positions.length / 3;
  surface.positions.push(point.x, point.y, point.z);
  surface.colours.push(colour[0] * shade, colour[1] * shade, colour[2] * shade);
  surface.uvs.push(u, v);
  return id;
};

export const appendBotanicalTube = (surface: BotanicalSurface, tube: BotanicalTube, detail: number) => {
  const trunk = tube.radius > .045;
  let sides = detail === 2 ? 6 : 4;
  if (trunk) sides = detail === 2 ? 12 : 8;
  if (tube.radius < .009) sides = 3;
  const colour = tube.colour
    ? new Color().setRGB(...tube.colour, SRGBColorSpace).toArray() as BotanicalPoint
    : undefined;
  const up = new Vector3(0, 1, 0), first = surface.positions.length / 3, stride = sides + 1;
  const last = tube.path.length - 1;
  for (let ring = 0; ring <= last; ring++) {
    const centre = new Vector3(...tube.path[ring]!);
    const before = new Vector3(...tube.path[Math.max(0, ring - 1)]!);
    const after = new Vector3(...tube.path[Math.min(last, ring + 1)]!);
    const tangent = after.sub(before).normalize();
    const side = tangent.clone().cross(Math.abs(tangent.y) > .95 ? new Vector3(1, 0, 0) : up).normalize();
    const normal = tangent.clone().cross(side).normalize();
    const t = ring / last;
    let radius = tube.radius + (tube.tipRadius - tube.radius) * t;
    if (tube.rings) radius *= ring % 2 === 0 ? 1.035 : .945;
    surface.tubeSeams.push([first + ring * stride, first + ring * stride + sides]);
    for (let index = 0; index <= sides; index++) {
      const angle = index / sides * Math.PI * 2;
      const position = centre.clone().addScaledVector(side, Math.cos(angle) * radius)
        .addScaledVector(normal, Math.sin(angle) * radius);
      vertex(surface, position, .87 + Math.sin(angle + ring * .4) * .08, index / sides,
        tube.rings ? t : t * 4, colour);
      if (ring === last || index === sides) continue;
      const a = first + ring * stride + index, b = a + 1;
      surface.indices.push(a, b, a + stride, b, b + stride, a + stride);
    }
  }
  for (let index = 1; index < sides - 1; index++) {
    surface.indices.push(first, first + index + 1, first + index);
    const end = first + last * stride;
    surface.indices.push(end, end + index, end + index + 1);
  }
};

export const appendBotanicalBlade = (surface: BotanicalSurface, blade: BotanicalBlade, detail: number) => {
  const start = new Vector3(...blade.start), end = new Vector3(...blade.end);
  const direction = end.clone().sub(start), length = direction.length(), axis = direction.clone().normalize();
  const side = axis.clone().cross(new Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < .01) side.set(1, 0, 0);
  side.applyAxisAngle(axis, Math.sin(blade.twist) * 1.08);
  const normal = side.clone().cross(axis).normalize();
  const outline = detail === 2 ? [[0, 0], [-.34, .22], [-.5, .53], [-.28, .80],
    [0, 1], [.28, .80], [.5, .53], [.34, .22]] : [[0, 0], [-.5, .48], [0, 1], [.5, .48]];
  const ids: number[] = [];
  for (const [x = 0, t = 0] of outline) {
    const point = start.clone().addScaledVector(direction, t).addScaledVector(side, x * blade.width)
      .addScaledVector(normal, Math.sin(t * Math.PI) * length * .055);
    ids.push(vertex(surface, point, blade.shade * (.94 + t * .08), x + .5, t));
  }
  const middle = vertex(surface, start.clone().addScaledVector(direction, .5)
    .addScaledVector(normal, length * .10), blade.shade * 1.04, .5, .5);
  for (let index = 0; index < ids.length; index++)
    surface.indices.push(middle, ids[index]!, ids[(index + 1) % ids.length]!);
};

const fanRibs = (detail: number) => {
  if (detail === 2) return 16;
  if (detail === 1) return 12;
  return 8;
};
const fanRings = (detail: number) => {
  if (detail === 2) return [.34, .68, 1];
  if (detail === 1) return [.42, 1];
  return [.48, 1];
};

export const appendBotanicalFan = (surface: BotanicalSurface, fan: BotanicalFan, detail: number) => {
  const base = new Vector3(...fan.start), ribs = fanRibs(detail), rings = fanRings(detail);
  const edge = 1.24, cos = Math.cos(fan.elevation), sin = Math.sin(fan.elevation);
  const axis = new Vector3(Math.cos(fan.direction) * cos, sin, Math.sin(fan.direction) * cos);
  const side = new Vector3(-Math.sin(fan.direction), 0, Math.cos(fan.direction));
  const normal = new Vector3(-sin * Math.cos(fan.direction), cos, -sin * Math.sin(fan.direction));
  const hub = base.clone().addScaledVector(axis, fan.radius * fan.costa);
  const centre = vertex(surface, hub, fan.shade * 1.04, .5, 0);
  const left = vertex(surface, base.clone().addScaledVector(side, fan.radius * .035),
    fan.shade * .86, .38, 0);
  const right = vertex(surface, base.clone().addScaledVector(side, -fan.radius * .035),
    fan.shade * .86, .62, 0);
  const hubLeft = vertex(surface, hub.clone().addScaledVector(side, fan.radius * .055),
    fan.shade * .90, .45, 0);
  const hubRight = vertex(surface, hub.clone().addScaledVector(side, -fan.radius * .055),
    fan.shade * .90, .55, 0);
  // Two long triangles form the visible costapalmate costa from the hastula to the fan hub.
  surface.indices.push(left, hubLeft, centre, centre, hubRight, right);
  const rows: number[][] = [];
  for (const [ring, reach] of rings.entries()) for (let spoke = 0; spoke <= ribs; spoke++) {
    const angle = -edge + spoke / ribs * edge * 2;
    const split = ring === rings.length - 1 && spoke % 2 === 1 ? .86 : 1;
    const pleat = ((spoke % 2 === 0 ? 1 : -1) * .045 + Math.cos(angle) * .032) * reach * fan.radius;
    const point = hub.clone().addScaledVector(axis, Math.cos(angle) * fan.radius * reach * split)
      .addScaledVector(side, Math.sin(angle) * fan.radius * reach * split)
      .addScaledVector(normal, pleat - .025 * reach * reach * fan.radius)
      .add(new Vector3(0, fan.rise * reach, 0));
    rows[ring] ??= [];
    rows[ring]!.push(vertex(surface, point, fan.shade * (.88 + (ring + 1) / (rings.length + 1) * .18),
      (Math.sin(angle) + 1) / 2, reach));
  }
  const first = rows[0]!;
  for (let spoke = 0; spoke < ribs; spoke++) surface.indices.push(centre, first[spoke]!, first[spoke + 1]!);
  for (let band = 0; band < rows.length - 1; band++) {
    const a = rows[band]!, b = rows[band + 1]!;
    for (let spoke = 0; spoke < ribs; spoke++) {
      surface.indices.push(a[spoke]!, b[spoke]!, a[spoke + 1]!,
        a[spoke + 1]!, b[spoke]!, b[spoke + 1]!);
    }
  }
};

/** Minimal date bipyramid: equator ring scale and tip scale on the fruit radii. */
const MINIMAL_DATE_GIRTH = 1.2, MINIMAL_DATE_TIP = 1.1;
const MINIMAL_DATE_AXES: readonly BotanicalPoint[] = [[0, MINIMAL_DATE_TIP, 0], [0, -MINIMAL_DATE_TIP, 0],
  ...[0, 1, 2].map(side => [Math.cos(side * Math.PI * 2 / 3) * MINIMAL_DATE_GIRTH, 0,
    Math.sin(side * Math.PI * 2 / 3) * MINIMAL_DATE_GIRTH] as BotanicalPoint)];
const MINIMAL_DATE_FACES = [[0, 3, 2], [0, 4, 3], [0, 2, 4], [1, 2, 3], [1, 3, 4], [1, 4, 2]] as const;

export const appendBotanicalFruit = (surface: BotanicalSurface, fruit: BotanicalFruit, detail: number) => {
  const colour = new Color().setRGB(...fruit.colour, SRGBColorSpace).toArray() as BotanicalPoint;
  if (fruit.kind === "date" && detail < 2) {
    // Minimal date bunches use a triangular bipyramid: six triangles per fruit give an oblong bead
    // silhouette from every side (a tetrahedron read as a spike) inside the Minimal palm budget.
    const centre = new Vector3(...fruit.centre), first = surface.positions.length / 3;
    for (const axis of MINIMAL_DATE_AXES) vertex(surface, centre.clone().add(new Vector3(
      axis[0] * fruit.radius[0], axis[1] * fruit.radius[1], axis[2] * fruit.radius[2])),
      1, 0, 0, colour);
    for (const [a, b, c] of MINIMAL_DATE_FACES) surface.indices.push(first + a, first + b, first + c);
    return;
  }
  const intricate = detail === 2 && fruit.radius[0] > .018;
  const tiny = fruit.radius[0] <= .020;
  let sides = 6, rings = 4;
  if (tiny) { sides = 4; rings = 3; }
  else if (intricate) { sides = 9; rings = 6; }
  if (fruit.kind === "date") { sides = 4; rings = 2; }
  const first = surface.positions.length / 3;
  for (let ring = 0; ring <= rings; ring++) {
    const latitude = Math.PI * ring / rings;
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const point = new Vector3(fruit.centre[0] + Math.sin(latitude) * Math.cos(angle) * fruit.radius[0],
        fruit.centre[1] + Math.cos(latitude) * fruit.radius[1],
        fruit.centre[2] + Math.sin(latitude) * Math.sin(angle) * fruit.radius[2]);
      vertex(surface, point, .88 + Math.sin(latitude) * .10, side / sides, ring / rings, colour);
      if (ring === rings) continue;
      const a = first + ring * sides + side, b = first + ring * sides + (side + 1) % sides;
      if (ring !== 0) surface.indices.push(a, b, a + sides);
      if (ring !== rings - 1) surface.indices.push(b, b + sides, a + sides);
    }
  }
};

export const finishBotanicalSurface = (surface: BotanicalSurface) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(surface.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(surface.colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(surface.uvs, 2));
  geometry.setIndex(surface.indices); geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal"), average = new Vector3();
  for (const [first, last] of surface.tubeSeams) {
    average.set(normals.getX(first) + normals.getX(last), normals.getY(first) + normals.getY(last),
      normals.getZ(first) + normals.getZ(last)).normalize();
    normals.setXYZ(first, average.x, average.y, average.z);
    normals.setXYZ(last, average.x, average.y, average.z);
  }
  return geometry;
};
