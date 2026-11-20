/** Plains-inspired game architecture, rather than a reconstruction of one historical people. */
export type IndigenousRoofProfile = "tipi" | "earth" | "barrel" | "awning" | "framed";

/** Normalized solid roof: rim at -.5, crown at .5, contained in the authored box. */
export const indigenousRoofHeight = (profile: IndigenousRoofProfile, x: number, z: number,
  entrance?: readonly [number, number, number], rearEntrance?: readonly [number, number, number]) => {
  const across = Math.abs(x) * 2, along = Math.abs(z) * 2;
  const portal = entrance && x >= entrance[0] && x <= entrance[1] && z > -.05;
  const rearPortal = rearEntrance && x >= rearEntrance[0] && x <= rearEntrance[1] && z < .05;
  const opening = Math.max(portal ? entrance[2] : -.5, rearPortal ? rearEntrance[2] : -.5);
  if (profile === "framed") return .5;
  if (profile === "tipi") return Math.max(opening, .5 - Math.min(1, Math.hypot(across, along)));
  if (profile === "earth") {
    // Rounded longhouse: a barrel centre with curved capsule ends, never a square earth block.
    const end = Math.max(0, along - .4) / .6;
    const radius = Math.hypot(across, end);
    return Math.max(opening, -.5 + Math.sqrt(Math.max(0, 1 - radius * radius)));
  }
  if (profile === "barrel") return -.5 + Math.sqrt(Math.max(0, 1 - across * across));
  return .5 - across - .08 * (1 - across) * (1 - along * along);
};
