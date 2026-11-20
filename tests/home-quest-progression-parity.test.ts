import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { runHomeProgression } from "./helpers/home-quest-progression";
import { HOME_PROGRESSION_SCENARIOS } from "./helpers/home-quest-scenarios";

/**
 * QU §10.1 step 3 behaviour parity: the golden was recorded from the code tutorial and code daily runtime (lane
 * TRG6, before the cut-over to the default home book). The book runtime must reproduce every step: active ids,
 * readiness, progress, skip rules, refusals, XP, levels, daily ids and reward goods.
 */
const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/home-quest-progression.golden.json", import.meta.url),
  "utf8")) as { run: unknown; scenario: (typeof HOME_PROGRESSION_SCENARIOS)[number] }[];

it.each(HOME_PROGRESSION_SCENARIOS)("replays the recorded home progression for %o", scenario => {
  const recorded = GOLDEN.find(entry => JSON.stringify(entry.scenario) === JSON.stringify(scenario));
  expect(runHomeProgression(scenario)).toEqual(recorded?.run);
});
