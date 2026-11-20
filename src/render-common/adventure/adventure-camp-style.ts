import { ADVENTURE_THEMES, type AdventureTheme } from "../../shared/settlement/adventure-themes";

export const ADVENTURE_CAMP_THEMES = ["bandit", ...ADVENTURE_THEMES] as const;
export type AdventureCampTheme = AdventureTheme | "bandit";
export type CampTentVariant = "shelter" | "command" | "awning";
export type CampCanvasShape = "ridge" | "pavilion" | "round" | "hipped" | "saddle" | "pagoda";
export type CampColor = readonly [number, number, number];

export interface AdventureCampStyle {
  canvas: CampColor;
  accent: CampColor;
  trim: CampColor;
  wood: CampColor;
  shape: CampCanvasShape;
  raised: boolean;
  snow: boolean;
}

const STYLES: Record<AdventureCampTheme, AdventureCampStyle> = {
  bandit: { canvas: [.35, .065, .045], accent: [.72, .35, .085], trim: [.69, .53, .28],
    wood: [.14, .07, .035], shape: "ridge", raised: false, snow: false },
  desert: { canvas: [.025, .3, .34], accent: [.84, .39, .035], trim: [.085, .1, .28],
    wood: [.33, .2, .1], shape: "pavilion", raised: false, snow: false },
  forest: { canvas: [.07, .28, .12], accent: [.48, .07, .04], trim: [.72, .54, .27],
    wood: [.28, .16, .07], shape: "round", raised: false, snow: false },
  swamp: { canvas: [.16, .32, .24], accent: [.58, .22, .085], trim: [.55, .48, .29],
    wood: [.18, .13, .07], shape: "saddle", raised: true, snow: false },
  tropical: { canvas: [.025, .38, .42], accent: [.8, .22, .12], trim: [.9, .74, .31],
    wood: [.48, .31, .12], shape: "pagoda", raised: false, snow: false },
  winter: { canvas: [.1, .15, .35], accent: [.63, .07, .08], trim: [.88, .91, .93],
    wood: [.22, .13, .08], shape: "ridge", raised: false, snow: true }
};

export const adventureCampStyle = (theme: AdventureCampTheme = "bandit") => STYLES[theme];
