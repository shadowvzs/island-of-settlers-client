import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";
import { type RubbleCell, type RubblePoint, rubbleRandom } from "./indigenous-rubble-cells";
import { createStructuralRockGeometry } from "./structural-rock-geometry";

export interface RubbleSurfaceVertex { point: RubblePoint; depth: number; colour: readonly number[] }
export type RubbleSurface = RubbleSurfaceVertex[];
const interpolate = (a: RubbleSurfaceVertex, b: RubbleSurfaceVertex, t: number): RubbleSurfaceVertex => ({
  point: [a.point[0] + (b.point[0] - a.point[0]) * t, a.point[1] + (b.point[1] - a.point[1]) * t],
  depth: a.depth + (b.depth - a.depth) * t,
  colour: a.colour.map((value, axis) => value + (b.colour[axis]! - value) * t)
});

export const clipRubbleSurface = (surface: RubbleSurface, a: number, b: number, c: number): RubbleSurface => {
  const output: RubbleSurface = [];
  for (let index = 0; index < surface.length; index++) {
    const from = surface[index]!, to = surface[(index + 1) % surface.length]!;
    const first = a * from.point[0] + b * from.point[1] - c;
    const second = a * to.point[0] + b * to.point[1] - c;
    if (first >= -1e-10) output.push(from);
    if ((first < 0) !== (second < 0)) output.push(interpolate(from, to, first / (first - second)));
  }
  return output;
};

/** Same natural varied boulder topology as the approved Indigenous well, fitted rather than repeated balls. */
export const indigenousRubbleStone = ({ outline, seed }: RubbleCell, facets:8|20|80=20): RubbleSurface[] => {
  const centre: RubblePoint = [outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
    outline.reduce((sum, point) => sum + point[1], 0) / outline.length];
  const minX = Math.min(...outline.map(point => point[0])), maxX = Math.max(...outline.map(point => point[0]));
  const minY = Math.min(...outline.map(point => point[1])), maxY = Math.max(...outline.map(point => point[1]));
  const rock = createStructuralRockGeometry(facets===80, seed, facets);
  const positions = rock.getAttribute("position"), colours = rock.getAttribute("color");
  const surfaces: RubbleSurface[] = [], tone = .84 + rubbleRandom(seed + 3) * .20;
  const angle = (rubbleRandom(seed + 7) - .5) * .6, sine = Math.sin(angle), cosine = Math.cos(angle);
  try {
    for (let index = 0; index < positions.count; index += 3) {
      const points = [0, 1, 2].map(corner => [positions.getX(index + corner), positions.getY(index + corner),
        positions.getZ(index + corner)]);
      const [a, b, c] = points;
      // The rear half is bonded inside the solid masonry. Keep genuine outward rock faces,
      // including their irregular depth and fractures; never replace them with a flat disk.
      const facing = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!);
      if (facing <= 1e-7) continue;
      let surface: RubbleSurface = points.map(([x, y, z], corner) => ({
        point: [centre[0] + (x! * cosine - y! * sine) * (maxX - minX) * 1.12,
          centre[1] + (x! * sine + y! * cosine) * (maxY - minY) * 1.14],
        depth: z! * (facets===8?.10:.22) - (facets===8?.04:.08),
        colour: [colours.getX(index + corner) * tone, colours.getY(index + corner) * tone,
          colours.getZ(index + corner) * tone]
      }));
      // Keep the well boulder's natural silhouette. The old broad polygon clipping flattened
      // its character into fitted slabs. Adjacent buried bearing surfaces may overlap.
      surface=clipRubbleSurface(surface,0,1,0);
      surface=clipRubbleSurface(surface,0,-1,-CATAPULT_SHAFT_HEIGHT);
      if (surface.length >= 3) surfaces.push(surface);
    }
  } finally { rock.dispose(); }
  return surfaces;
};
