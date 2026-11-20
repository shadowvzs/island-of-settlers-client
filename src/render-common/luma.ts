/**
 * The Rec.709 luma weights the frame post chain uses (bloom selection, exposure metering,
 * ambient-occlusion direct share). One export so the GLSL twins and the TSL chain cannot drift.
 */
export const LUMA_REC709 = [0.2126, 0.7152, 0.0722] as const;
