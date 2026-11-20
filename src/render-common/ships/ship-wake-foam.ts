/**
 * SHIP-WAKE foam tuning, shared by the WebGL wake shader (three-ship-wakes.ts) and its TSL twin.
 * The wake is presentation only; these values shape the Kelvin arms, the churned stern band and
 * the foam fade. Every constant is exported here, never retyped in a shader.
 */
export const SHIP_WAKE_FOAM = {
  /** Kelvin arms: gaussian line inside each ribbon edge, widening with age. */
  armAgeWidth: .6,
  armGain: .85,
  armGainAge: .35,
  armOffset: .84,
  armWidth: .22,
  /** Churned band behind the stern, widening into the V. */
  churnAgeGain: .3,
  churnAgeHalf: .7,
  churnGain: .8,
  churnHalfBeam: .42,
  churnStart: .75,
  churnFull: 1.05,
  /** Faint turbulent fill between the arms. */
  fillEnd: 1.6,
  fillGain: .16,
  fillInner: .4,
  fillOuter: .85,
  fillStart: .9,
  fillTailEnd: 3,
  fillTailStart: 2,
  /** Foam stays inside the ribbon (1 at the centre, 0 at the edge). */
  edgeStart: .9,
  /** Fade: age, depth and distance behind the bow. */
  ageExponent: 1.5,
  alongEnd: 1.2,
  alongStart: 0,
  depthEnd: .6,
  depthStart: .15,
  /** Coverage threshold and final alpha. */
  alpha: .8,
  minimumFoam: .01,
  /** Lace modulates brightness only (mix from floor to 1). */
  laceFloor: .5,
  /** Lighting of the foam band. */
  ambientBase: .65,
  ambientShare: .6,
  ambientSun: .45,
  foamBase: .75,
  foamLight: .25,
  shadowFloor: .75,
  shadowGain: .25,
  sunShare: .6
} as const;
