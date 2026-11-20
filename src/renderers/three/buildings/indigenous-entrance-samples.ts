type Sample = { angle: number; edge?: string; x?: number };

/** The doorway's straight edges must be sampled exactly, rather than zigzagging across polar cells. */
export const indigenousEntranceSamples = (
  count: number, radiusAt: (angle: number) => number,
  entrance?: readonly [number, number, number], rearEntrance?: readonly [number, number, number]
) => {
  const circle = Math.PI * 2;
  const samples: Sample[] = Array.from({ length: count + 1 }, (_, index) =>
    ({ angle: index / count * circle,
      edge: index === 0 ? "seam-start" : undefined }));
  samples[count]!.edge = "seam-end";
  for (const [opening, rear] of [[entrance, false], [rearEntrance, true]] as const) {
    if (!opening) continue;
    for (const [index, x] of opening.slice(0, 2).entries()) {
      if (Math.abs(x) >= radiusAt(Math.PI / 2) - 1e-7) continue;
      let low = -Math.PI / 2, high = Math.PI / 2;
      for (let step = 0; step < 28; step++) {
        const angle = (low + high) / 2;
        if (radiusAt(angle) * Math.sin(angle) < x) low = angle;
        else high = angle;
      }
      const angle = rear ? Math.PI - (low + high) / 2 : (low + high) / 2;
      samples.push({ angle: (angle + circle) % circle, edge: `${rear ? "rear" : "front"}-${index}`, x });
    }
  }
  const unique: Sample[] = [];
  for (const sample of samples.sort((a, b) => a.angle - b.angle)) {
    const previous = unique.at(-1);
    if (previous && sample.angle - previous.angle < 1e-7) {
      if (sample.edge) Object.assign(previous, sample);
    } else unique.push(sample);
  }
  return unique;
};
