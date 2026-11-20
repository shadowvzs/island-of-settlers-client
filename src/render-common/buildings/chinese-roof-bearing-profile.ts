/** Continuous along-span rows and cross-span coordinates (-.5..+.5) form one closed timber mesh. */
export interface ChineseRoofBearingProfile {
  axis: 0 | 2;
  across: readonly number[];
  samples: readonly {share:number;heights:readonly number[]}[];
}
