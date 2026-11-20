import { type MeshBuilder, NO_UV, normalize, type Vec3, type VertexStyle } from "../mesh-builder";
import { add, scale } from "../tree-parts";
import { addSpindle, type Attach,getAxisFrame, roundProfile } from "./plant-parts";

export interface PetalHeadOptions {
  /** Petal tips rise by this fraction of the radius (0 flat daisy, 0.6 buttercup cup). */
  cup: number;
  facing: Vec3;
  petals: number;
  radius: number;
}

/**
 * Flower head on its stalk tip: a star of petals (tips and notches) around a raised centre. The
 * head moves with the stalk (same path), with a little flutter on the petal tips.
 */
export const addPetalHead = (
  builder: MeshBuilder,
  attach: Attach,
  options: PetalHeadOptions,
  petals: VertexStyle,
  centre: VertexStyle
) => {
  const { axis, first, second } = getAxisFrame(options.facing);
  const rooted = { flutter: 0, path: attach.path };
  const middle = builder.addVertex(attach.position, axis, petals, NO_UV, rooted);
  const ring = builder.vertexCount;
  const points = options.petals * 2;
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const tip = index % 2 === 0;
    const reach = options.radius * (tip ? 1 : 0.4);
    const lift = tip ? options.cup * options.radius : 0;
    const out = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
    const position = add(add(attach.position, scale(out, reach)), scale(axis, lift));
    const wind = { flutter: tip ? 0.25 : 0, path: attach.path };
    builder.addVertex(position, normalize(add(axis, scale(out, 0.3))), petals, NO_UV, wind);
  }
  for (let index = 0; index < points; index += 1) {
    builder.addTriangle(middle, ring + index, ring + ((index + 1) % points));
  }
  const disc = options.radius * 0.38;
  addSpindle(
    builder,
    { path: attach.path, position: add(attach.position, scale(axis, -disc * 0.2)) },
    { axis, length: disc * 0.9, profile: roundProfile(disc), rings: 2, sides: 5 },
    centre
  );
};

/** Compact head (clover, thistle brush, seed heads): a rounded body along the stalk. */
export const addHeadBody = (
  builder: MeshBuilder,
  attach: Attach,
  axis: Vec3,
  size: [number, number],
  style: VertexStyle
) =>
  addSpindle(
    builder,
    attach,
    { axis, length: size[0], profile: roundProfile(size[1]), rings: 3, sides: 5 },
    style
  );
