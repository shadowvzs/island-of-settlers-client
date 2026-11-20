import type { PeachProductionAtlasSources } from "./peach-production-resources";

/** Original native-K captures; callers retain control of readiness and catalogue activation. */
export const getPeachProductionAtlasSources = (detailed: boolean,
  baseUrl = import.meta.env.BASE_URL): PeachProductionAtlasSources => {
  const directory = `${baseUrl.replace(/\/?$/, "/")}textures/plants/peach-k/`;
  const quality = detailed ? "high" : "minimal";
  return {
    far: [0, 1, 2].map(variant => `${directory}peach-atlas-v${variant}.png`) as [string, string, string],
    crowns: [0, 1, 2].map(variant => `${directory}peach-crowns-${quality}-v${variant}.png`) as [string, string, string],
    flowerColour: "#ed9bb5",
  };
};
