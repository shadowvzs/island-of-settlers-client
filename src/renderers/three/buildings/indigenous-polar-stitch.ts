export interface PolarRoofVertex { angle: number; edge?: string; vertex: number }

/** Mandatory doorway edges join to one another before the intervening curved cells are filled. */
export const stitchIndigenousPolarLoops = (
  inner: PolarRoofVertex[], outer: PolarRoofVertex[], indices: number[]
) => {
  const joins = inner.flatMap((point, index) => {
    if (!point.edge) return [];
    const other = outer.findIndex(candidate => candidate.edge === point.edge);
    return other < 0 ? [] : [{ inner: index, outer: other }];
  });
  for (let zone = 0; zone < joins.length - 1; zone++) {
    const start = joins[zone]!, end = joins[zone + 1]!;
    const innerAngle = inner[start.inner]!.angle, outerAngle = outer[start.outer]!.angle;
    const innerSpan = inner[end.inner]!.angle - innerAngle;
    const outerSpan = outer[end.outer]!.angle - outerAngle;
    let a = start.inner, b = start.outer;
    while (a < end.inner || b < end.outer) {
      const advanceInner = b === end.outer || (a < end.inner
        && (inner[a + 1]!.angle - innerAngle) / innerSpan
          <= (outer[b + 1]!.angle - outerAngle) / outerSpan);
      if (advanceInner) {
        indices.push(inner[a]!.vertex, outer[b]!.vertex, inner[a + 1]!.vertex);a++;
      } else {
        indices.push(inner[a]!.vertex, outer[b]!.vertex, outer[b + 1]!.vertex);b++;
      }
    }
  }
};
