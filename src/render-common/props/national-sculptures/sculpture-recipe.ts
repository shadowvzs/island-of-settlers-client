import type { SculptureAnatomy } from "./sculpture-anatomy";

export type SculpturePoint = readonly [number, number, number];
export type SculptureKind = "phoenix" | "qilin";
export type SculptureMaterial = "gold" | "dark" | "jade" | "phoenixCopper" | "phoenixPlumage";
export interface SculptureRing { y: number; rx: number; rz: number; x?: number; z?: number }
export type SculptureShape =
  | SculptureAnatomy
  | { kind: "ellipsoid"; segments: number; scale: SculpturePoint; position: SculpturePoint; pitch: number }
  | { kind: "tube"; points: readonly SculpturePoint[]; radii: number[]; segments: number; sides: number }
  | { kind: "feather"; points: readonly SculpturePoint[]; width: number; detailed: boolean; contour?: true }
  | { kind: "loft"; rings: readonly SculptureRing[]; sides: number };
export interface SculptureGeometryRecipe {
  shape: SculptureShape;
  transforms: { kind: "rotateX" | "rotateY" | "rotateZ" | "translate"; values: number[] }[];
}
export interface SculpturePart {
  name: string; material: SculptureMaterial; geometry: SculptureGeometryRecipe;
  colorRamp?: "flame" | "flame-soft" | "jade" | "jade-scale";
}
export interface SculptureRecipe {
  kind: SculptureKind; detailed: boolean; parts: SculpturePart[];
  /** Authoring units; feet/perch origin is stable between LODs and independent of every placement. */
  mountOrigin: SculpturePoint;
  bounds: { min: SculpturePoint; max: SculpturePoint };
}

/** A transient CPU-only authoring helper; exported recipes contain plain serializable data. */
class GeometryRecipe {
  data: SculptureGeometryRecipe;
  constructor(shape: SculptureShape) { this.data = { shape, transforms: [] }; }
  rotateX(angle: number) { this.data.transforms.push({ kind: "rotateX", values: [angle] }); return this; }
  rotateY(angle: number) { this.data.transforms.push({ kind: "rotateY", values: [angle] }); return this; }
  rotateZ(angle: number) { this.data.transforms.push({ kind: "rotateZ", values: [angle] }); return this; }
  translate(x: number, y: number, z: number) {
    this.data.transforms.push({ kind: "translate", values: [x, y, z] }); return this;
  }
}
export const ellipsoid = (segments: number, scale: SculpturePoint, position: SculpturePoint, pitch = 0) =>
  new GeometryRecipe({ kind: "ellipsoid", segments, scale, position, pitch });
export const curveThrough = (points: readonly SculpturePoint[]) => points;
export const profileTube = (points: readonly SculpturePoint[], radius: (t: number) => number,
  segments: number, sides: number) => new GeometryRecipe({ kind: "tube", points,
  radii: Array.from({ length: segments + 1 }, (_, index) => radius(index / segments)), segments, sides });
export const carvedSculptureFeather = (points: readonly SculpturePoint[], width: number, detailed: boolean,
  contour = false) => new GeometryRecipe({ kind: "feather", points, width, detailed,
  ...(contour ? { contour: true as const } : {}) });
export const loftGeometry = (rings: readonly SculptureRing[], sides: number) =>
  new GeometryRecipe({ kind: "loft", rings, sides });
export const organicAnatomy = (shape: SculptureAnatomy) => new GeometryRecipe(shape);
export const sculptureRecipeBuilder = () => {
  const parts: SculpturePart[] = [];
  const add = (name: string, material: SculptureMaterial, geometry: GeometryRecipe) => {
    const part: SculpturePart = { name, material, geometry: geometry.data };
    if (/phoenix_(primary_feather|secondary_feather|layered_covert|flowing_tail|flame_crest|breast_plumage|neck_plumage)/.test(name)) {
      part.material = "phoenixPlumage";
      part.colorRamp = /breast_plumage|neck_plumage/.test(name) ? "flame-soft" : "flame";
    } else if (material === "jade") part.colorRamp = name.endsWith("_scale") ? "jade-scale" : "jade";
    parts.push(part);
  };
  return { add, parts };
};
