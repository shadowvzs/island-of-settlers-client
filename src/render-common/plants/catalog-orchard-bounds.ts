import type { BotanicalGraph, BotanicalPoint } from "./catalog-orchard-graph";

export interface BotanicalBounds { min: BotanicalPoint; max: BotanicalPoint }
interface GraphEnvelope {
  roots: BotanicalBounds;
  trunk: BotanicalBounds;
  canopy: BotanicalBounds;
  horizontal: number;
  vertical: number;
}
const emptyBounds = (): BotanicalBounds => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const include = (bounds: BotanicalBounds, point: BotanicalPoint, extent: BotanicalPoint) => {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis]!, point[axis]! - extent[axis]!);
    bounds.max[axis] = Math.max(bounds.max[axis]!, point[axis]! + extent[axis]!);
  }
};

/** Analytic primitive bounds are shared by worker-safe placement and mesh fitting. No renderer dependency. */
export const catalogBotanicalEnvelope = (graph: BotanicalGraph): GraphEnvelope => {
  const roots = emptyBounds(), trunk = emptyBounds(), canopy = emptyBounds();
  let radius = 0, height = 0;
  const point = (bounds: BotanicalBounds, centre: BotanicalPoint, extent: BotanicalPoint) => {
    include(bounds, centre, extent);
    radius = Math.max(radius, Math.hypot(centre[0], centre[2]) + Math.max(extent[0], extent[2]));
    height = Math.max(height, centre[1] + extent[1]);
  };
  for (const tube of graph.tubes) {
    let bounds = canopy;
    if (tube.trunk || tube.path[0]![1] < .3) bounds = trunk;
    if (!tube.trunk && tube.path[0]![1] < .3 && tube.path.at(-1)![1] < .3) bounds = roots;
    for (let index = 0; index < tube.path.length; index++) {
      let width = tube.radius + (tube.tipRadius - tube.radius) * index / (tube.path.length - 1);
      if (tube.rings) width *= 1.035;
      point(bounds, tube.path[index]!, [width, width, width]);
    }
  }
  for (const blade of graph.blades) {
    const delta = blade.end.map((value, axis) => value - blade.start[axis]!) as BotanicalPoint;
    const length = Math.hypot(...delta), extent = blade.width * .5 + length * .10;
    point(canopy, blade.start, [extent, extent, extent]);
    point(canopy, blade.end, [extent, extent, extent]);
  }
  for (const fan of graph.fans) {
    // Sample the actual tilted costapalmate sector rather than wrapping the fan in a full sphere.
    const cos = Math.cos(fan.elevation), sin = Math.sin(fan.elevation);
    const axis: BotanicalPoint = [Math.cos(fan.direction) * cos, sin, Math.sin(fan.direction) * cos];
    const side: BotanicalPoint = [-Math.sin(fan.direction), 0, Math.cos(fan.direction)];
    const padding = Math.max(.015, fan.radius * .06);
    for (const angle of [-1.25, -.62, 0, .62, 1.25]) for (const reach of [fan.costa, .62, 1]) {
      const radial = fan.radius * reach * Math.cos(angle), across = fan.radius * reach * Math.sin(angle);
      point(canopy, [fan.start[0] + axis[0] * radial + side[0] * across,
        fan.start[1] + axis[1] * radial + fan.rise * reach,
        fan.start[2] + axis[2] * radial + side[2] * across], [padding, padding, padding]);
    }
  }
  for (const fruit of graph.fruits) point(canopy, fruit.centre, fruit.radius);
  for (const attachment of graph.attachments) {
    const local = catalogBotanicalEnvelope(attachment.graph), { max, min } = local.canopy;
    const cos = Math.cos(attachment.yaw), sin = Math.sin(attachment.yaw);
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      point(canopy, [attachment.anchor[0] + x * cos + z * sin,
        attachment.anchor[1] + y,
        attachment.anchor[2] - x * sin + z * cos], [0, 0, 0]);
    }
  }
  return { roots, trunk, canopy, horizontal: Math.min(1, graph.radius * .98 / radius),
    vertical: Math.min(1, graph.height / height) };
};

/** Keep rooted soil contact separate from the clear bole and the raised crown. */
export const catalogBotanicalClearance = (graphs: BotanicalGraph[]): readonly BotanicalBounds[] => {
  const result = [emptyBounds(), emptyBounds(), emptyBounds()];
  for (const graph of graphs) {
    const envelope = catalogBotanicalEnvelope(graph);
    [envelope.roots, envelope.trunk, envelope.canopy].forEach((bounds, index) => {
      const min: BotanicalPoint = [bounds.min[0] * envelope.horizontal,
        Math.max(0, bounds.min[1] * envelope.vertical), bounds.min[2] * envelope.horizontal];
      const max: BotanicalPoint = [bounds.max[0] * envelope.horizontal,
        bounds.max[1] * envelope.vertical, bounds.max[2] * envelope.horizontal];
      include(result[index]!, min, [0, 0, 0]); include(result[index]!, max, [0, 0, 0]);
    });
  }
  return result;
};
