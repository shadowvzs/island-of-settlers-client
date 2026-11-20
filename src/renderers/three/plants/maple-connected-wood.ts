import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import type { OrnamentalLimb, OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";
import { mapleDisplayLimb, mapleHasTerminalBearing } from "./maple-display-limb";

const sections = (limb: OrnamentalLimb, detailed: boolean) => {
  if (limb.role === "twig") {
    if (detailed) return limb.path;
    return [limb.path[0]!, limb.path[1]!, limb.path.at(-1)!];
  }
  if (limb.role === "trunk") return limb.path;
  if (!detailed && limb.role === "branch" && limb.path.length === 3) return limb.path;
  let rings = 6;
  if (limb.role === "root") rings = detailed ? 6 : 5;
  if (limb.role === "branch" && limb.path.length === 3) rings = 4;
  const curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
  return Array.from({ length: rings + 1 }, (_, ring) => curve.getPoint(ring / rings).toArray());
};

const radialSides = (limb: OrnamentalLimb, detailed: boolean) => {
  if (limb.role === "twig" || limb.radius < .04) return 3;
  if (limb.role === "root") return 4;
  if (limb.role === "trunk") return detailed ? 10 : 6;
  if (detailed) return 7;
  return limb.parent === 0 ? 4 : 3;
};

/** Every canonical bearing is retained; the thin leaf shoots now have actual closed woody sections. */
export const createMapleConnectedWood = (graph: OrnamentalTreeGraph, authored: OrnamentalLimb,
  detailed: boolean, seed: number) => {
  const limb = mapleDisplayLimb(graph, authored, detailed, seed);
  const nodes = sections(limb, detailed), sides = radialSides(limb, detailed);
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [];
  const indices: number[] = [], last = nodes.length - 1;
  const twig = limb.role === "twig";
  const baseRadius = twig ? .0065 : limb.radius;
  let tipRadius = limb.tipRadius;
  if (twig) tipRadius = .0012;
  if (limb.role === "branch" && limb.radius < .04) tipRadius = Math.max(tipRadius, .0080);
  const curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
  const length = curve.getLength();
  const sectionCurve = new CatmullRomCurve3(nodes.map(point => new Vector3(...point)));
  const frames = sectionCurve.computeFrenetFrames(last, false);
  for (let ring = 0; ring <= last; ring++) {
    const centre = new Vector3(...nodes[ring]!);
    const across = frames.normals[ring]!, front = frames.binormals[ring]!;
    const t = ring / last;
    let radius = baseRadius * (1 - t) ** .90 + tipRadius * t;
    if (limb.role === "branch" && limb.radius < .04) radius *= 1 + Math.sin(t * Math.PI) * .22;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const normal = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(front, Math.sin(angle));
      let girth = radius;
      if (limb.role === "trunk") {
        const flare = Math.exp(-Math.max(0, centre.y) * 4);
        girth *= 1 + flare * (.10 + .075 * Math.sin(angle * 3 + graph.variant * .7));
      }
      positions.push(...centre.clone().addScaledVector(normal, girth).toArray()); normals.push(...normal.toArray());
      const shade = .89 + Math.cos(angle * 2 + seed * .41 + t * 2) * .075;
      colours.push(shade, shade, shade); uvs.push(side / sides, t * length * 4);
      if (ring === last || side === sides) continue;
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (limb.role !== "root" && (twig || !mapleHasTerminalBearing(graph, authored))) {
    const centre = positions.length / 3, tip = new Vector3(...nodes[last]!);
    const tangent = tip.clone().sub(new Vector3(...nodes[last - 1]!)).normalize();
    positions.push(...tip.toArray()); normals.push(...tangent.toArray()); colours.push(.79, .75, .67); uvs.push(.5, .5);
    if (sides === 3) {
      const end = last * (sides + 1);
      indices.push(end, end + 1, end + 2);
    } else for (let side = 0; side < sides; side++)
      indices.push(centre, last * (sides + 1) + side, last * (sides + 1) + side + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
