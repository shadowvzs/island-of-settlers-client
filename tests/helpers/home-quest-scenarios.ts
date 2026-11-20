import type { ProgressionScenario } from "./home-quest-progression";

/** Roman and two drink-chain nations; one island lacks every natural resource (QU §10.1 step 3). */
export const HOME_PROGRESSION_SCENARIOS: readonly ProgressionScenario[] = [
  { missingResources: false, nation: "roman" },
  { missingResources: false, nation: "viking" },
  { missingResources: true, nation: "japanese" }
];
