import { BufferGeometry, Float32BufferAttribute } from "three";

import { climberStemRings, foliageCardSurface, type FoliageSurface,
  roseHeadSurface } from "../../render-common/plants/climber-foliage-geometry";
import type { RoadClimberStem, RoadFoliagePart } from "../../render-common/road-decoration-recipe";

const surfaceGeometry = (surface: FoliageSurface, tint: readonly number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(surface.positions.flat(), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(surface.normals.flat(), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(surface.uvs.flat(), 2));
  geometry.setAttribute("color", new Float32BufferAttribute(surface.positions.flatMap(() => tint.slice(0, 3)), 3));
  geometry.setIndex(surface.indices);
  return geometry;
};

/** Indexed atlas card (6 triangles) or High rose bloom (~76 petal triangles); one shared foliage material. */
export const createRoadFoliageGeometry = (part: RoadFoliagePart) =>
  surfaceGeometry(part.kind === "foliage-card" ? foliageCardSurface(part) : roseHeadSurface(part), part.tint);

/** Smooth open tube through the stem's own rings: joints are shared, so canes never break at a bend. */
export const createRoadClimberStemGeometry = (stem: RoadClimberStem) => {
  const { lengths, rings } = climberStemRings(stem), sides = Math.max(3, stem.sides);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const [ring, { binormal, centre, normal, radius }] of rings.entries()) {
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
      const direction = [0, 1, 2].map(axis => normal[axis]! * cos + binormal[axis]! * sin);
      positions.push(...direction.map((value, axis) => centre[axis]! + value * radius));
      normals.push(...direction);
      // Bark grain runs along the stem: u around, v by length (about one repeat per 0.4 units).
      uvs.push(side / sides, lengths[ring]! * 2.5);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const at = ring * (sides + 1) + side, next = at + sides + 1;
    indices.push(at, at + 1, next, at + 1, next + 1, next);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(positions.map((_, index) => stem.tint[index % 3]!), 3));
  geometry.setIndex(indices);
  return geometry;
};
