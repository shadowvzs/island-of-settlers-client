/** A feasible simplex direction: zero-weight joints cannot donate skin ownership. */
export const clothSupportTransfer = (weights: readonly number[], dots: readonly number[], deficit: number) => {
  let donor = -1, recipient = -1, gain = 0;
  for (let from = 0; from < weights.length; from++) {
    if (weights[from]! <= 1e-8) continue;
    for (let to = 0; to < weights.length; to++) {
      if (weights[to]! >= 1 - 1e-8) continue;
      const difference = dots[to]! - dots[from]!;
      if (difference > gain) { donor = from; recipient = to; gain = difference; }
    }
  }
  if (donor < 0 || gain <= 1e-12 || deficit <= 1e-5) return undefined;
  const amount = Math.min(weights[donor]!, 1 - weights[recipient]!, .9 * deficit / gain);
  const next = [...weights];
  next[donor]! -= amount; next[recipient]! += amount;
  return { amount, donor, gain, recipient, weights: next };
};
