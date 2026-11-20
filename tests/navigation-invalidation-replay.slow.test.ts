import { describe, expect, it } from "vitest";

import {
  type NavigationInvalidationSettings,
  setNavigationInvalidation
} from "../src/shared/settlement/navigation-change-journal";
import { hashText } from "../src/shared/settlement/settlement-state-hash";
import { runMotionScenario } from "../tools/bench/military-motion-metrics";
import { crossingScenario, gateScenario, siegeScenario } from "../tools/bench/military-motion-scenarios";
import { developedMarchRun } from "./helpers/navigation-march-fixture";

/**
 * Final `saveState()` hashes the local invalidation must reproduce byte for byte in every mode.
 * Originally recorded on the pre-A03 code (897f92a5) and held through A03, A03b, A03 part b and
 * V08. Re-recorded on master 2026-11-07 after two known changes:
 * - save format 4 (fa837abe) changed the saved settlement shape, so the three queued scenarios
 *   moved even though their simulation behaviour did not;
 * - the developed fixture's demo save still carried a pre-Wildlife-2.0 animal blob; that blob was
 *   removed so the current loader can restore the island (governs the developed march).
 * Pre-V08 developed march was a380348d029a5645; V08's was 2af13da9c9ef1a40.
 * Perf lane 2026-11-07 (HQ doorway): the doorway overlap repair no longer takes carriers, settlers
 * and workers walking out of the HQ behind a loaded carrier for arrivals (the old code cut seven
 * such journeys short at the HQ doorstep in this march). Before: 4ec6c71262c56407.
 * Sim-bugs lane 2026-11-08 (D3 snapshot fidelity): a load now re-registers the loaded buildings' plots in the
 * wildlife/critter exclusion mask, as continuous play does at planning. The developed island loads with its
 * whole town, so its animals now spawn and walk outside those plots (their audited random draws are part of
 * the settlement save). Before: c9e87fe49b90622e.
 * Sim-bugs lane 2026-11-08 (hunter chase): a chasing hunter re-plans once per second on its own saved clock
 * (`huntReplan`); before, every free step reset the shared `timer`, so the chase ran a full ground search every
 * tick. The developed island's hunters now follow their planned route for that second. Before: 676f9573f891ae31.
 * Demand-dispatch lane 2026-11-09: consumers save the tick since which they wait for a ware
 * (`demandWaitSince`, the owner's demand-ranking age). The simulation is unchanged here: with that field
 * stripped both runs end on the previous hashes (march 90ec1f3aa8938f5b, siege 49579072ceb429bc);
 * the siege's military building and the march's consumers now carry the field.
 * MIL-ASSAULT 2026-11-09 (civilians are enemy targets): the march's computer groups stand in camp between their
 * move orders and now strike a villager outside a building within their camp radius (one carrier is wounded
 * in these 15 s). Only the enemy-bearing developed march moves. Before: 90ec1f3aa8938f5b.
 * MIL-ASSAULT 2026-11-09 (flee + stay inside): villagers near those groups now run for a safe storage and stay
 * indoors while a group stands near their door. Only the enemy-bearing developed march moves. Before:
 * a7ccf18f37bec4b4.
 * Main-session merge 2026-11-09: demand-dispatch (saved `demandWaitSince`) and MIL-ASSAULT combined; local, global
 * and strict modes agree. Before (MIL-ASSAULT alone): 9a2eafd0a96dd1f5.
 * SIM-CADENCE 2026-11-10 (owner-approved quarter-second cadence): parked door-queue arrivals re-check their turn
 * every 0.25 s, a failed proactive shoulder search waits 0.25 s, anticipation runs every second tick and traffic
 * segment samples are 0.02 tile. Local, global and strict modes agree. Before: developedMarch15
 * ce18ec68e20c9c74, siege 76f730a10e8513d4 (crossing and gate unchanged).
 * RED-TESTS 2026-11-11 (shipping demand ids): a covered need no longer takes and drops a demand id on every
 * reconcile, so the developed march's demand ids are 1-10 and `nextDemand` 11 (was 2-14, 71). Those are the only
 * saved differences; local, global and strict modes agree. Before: developedMarch15 68acf1feb531013c.
 * SAVE-DRIFT 2026-11-11 (save + reload = uninterrupted run): saves carry the battlefield working state
 * (`military.combat.field`, replacing `posts`), flow-group members keep only their start point (not a whole
 * actor clone), dormant carrier detour records are saved, and islands without a stock layout mark
 * `plainStockContacts`. Gate, siege and crossing behave identically (actor, building and soldier state hash
 * equal to the pre-lane code); only saved data changed. The developed march also behaves differently: its old
 * demo save's in-flight stock contacts are no longer re-derived at load (that reconciliation now runs only for
 * `plainStockContacts` saves); with it forced on, the march equals the pre-lane run. Local, global and strict
 * modes agree. Before: crossing 58ceb0b6a737ce5f, developedMarch15 03780f1fb8e50bb9, gate 7c2577fd1755e7ee,
 * siege f25d6793e596007e.
 * A13 phase 2 2026-11-13 (rules version: settlement save format 5): every final save equals master's field for
 * field except `version` (crossing, gate, siege and the developed march dumped and compared). Master no longer
 * matched its own baseline for three of them (developedMarch15 cf3f5ec16a6f7aeb, gate 23927e75cb34ed76, siege
 * bdb22f8c510522f5; crossing 5f3c414e593d131b matched). Before: developedMarch15 ca3cf5b32eb7e6e5, gate
 * c4b92e623e1424a1, siege cfa025696c75ee78.
 * A13 phase 3 2026-11-13 (rules version: settlement save format 6, the AI acts only on what its faction knows):
 * all four final saves dumped on master f0f91a7ac and on the lane equal field for field except `version` (no
 * knowledge is left at the end of any of them). Before: crossing 58ae448b184be616, developedMarch15
 * db25d29ee94d23dc, gate f92c5b202ce7c7af, siege e49ef1f538173aa4.
 * BD1 2026-11-13 (rules version: settlement save format 7, every building destroyable, merged raid target list):
 * the four final saves dumped on master 5dffd6abb and on the lane are equal field for field except `version`;
 * the developed march also gains `military.combat.knowledge.buildings` (24 player buildings its enemy faction saw,
 * the new building memory). No actor, building or soldier state differs. Before: crossing ce712a4879898d85,
 * developedMarch15 3dc7f20b621c4465, gate 75911bf760600760, siege 8e385de29e1a2033.
 * A14-1 2026-11-13 (rules version: settlement save format 8, commander role groups and positions): the four final
 * saves dumped on master 48ec32ec5 and on the lane are equal field for field except `version` (no computer squad
 * of these runs is split into role groups by its end). Before: crossing 1769b7e5682b10e0, developedMarch15
 * 524a5b5b8186f3d3, gate 947ca2faacf97a39, siege cc42a9a3b98946ba.
 * A14-2 2026-11-13 (rules version: settlement save format 9, morale, danger matrix and focus): the four final saves
 * dumped on master f70973237 and on the lane differ only in `version` and in the soldiers' field memories (new
 * `morale`/`calm`/`orderedTick` fields; in the developed march and the siege also memory order, anchors, seek
 * times and last attackers, as a new order now keeps the soldier's morale). No actor, building or soldier state
 * differs. Before: crossing 33a1eec28f5de7b7, developedMarch15 9109547e8b0b2576, gate 2801c751a9fbfb9a, siege
 * e3a69e38bea32159.
 * A14-2 follow-up (same format 9): computer soldiers also remember their commander squad (`squad` in the field
 * memory); final saves dumped on master 3dc3f6f15 and on the lane differ only in field memories and `version`
 * (crossing, gate, developed march: `squad`, `morale`, `calm`; siege unchanged). Before: crossing
 * 509bb9473874a75e, developedMarch15 753a6dd715996def, gate 91dee73c33a48fb7.
 * A14-3 2026-11-13 (rules version: settlement save format 10, covered retreat routes, rout rally points): the four
 * final saves dumped on master 93ac0685b and on the lane are equal field for field except `version` (no soldier of
 * these runs routs or retreats by the commander). Before: crossing c0e5f41fa349d692, developedMarch15
 * 39ac42b4f9131c8f, gate 82c3b48c26dd64c3, siege e61b07e0af45c127.
 * A14-4a 2026-11-13 (settlement save format 11, strategic director): with the lane's format number set back to 10
 * the four runs reproduce the A14-3 hashes exactly (no director force in these runs), so only `version` differs.
 * Before: crossing 8daade1bca072a7b, developedMarch15 dc713098e25d7416, gate 45fe0980f8cb60aa, siege
 * 00909eccf125f356.
 * A14-4b 2026-11-13 (settlement save format 12, strategic knowledge): the four final saves of the base (master
 * a1f512340 + the lane's bench-only commit 44d64d1e3) and of the lane hash equal without `version` and
 * `military.combat.knowledge` (TOOL-4 hash columns, docs/plans/a14-4b-2026-11-13.md); the knowledge block gains
 * `sectors` (all four), `sites` in place of `buildings` (developed march) and each record's first known tick.
 * Before: crossing a2e95922a4a26fda, developedMarch15 f499fc4d2594acd7, gate 37fe824df928978b, siege
 * 1b992599e7f1300f.
 * A14-4c 2026-11-16 (settlement save format 13, the economy AI's strategic contract): with the lane's format
 * number still 12 the four runs reproduce the A14-4b hashes exactly (no faction has intents), so only `version`
 * differs. Before: crossing 04808a793c4cc628, developedMarch15 53300e46b66eeb3b, gate a347fd1c298a39cf, siege
 * 25cddbaaf3a17537.
 * A14-5 2026-11-16 (settlement save format 14, commander levels): at format 13 the four runs reproduce the A14-4c
 * hashes exactly (every faction plays the medium profile, no script level), so only `version` differs. Before:
 * crossing c1a5339a01accfb3, developedMarch15 9b373559f3f480b4, gate ace0853fd08ca694, siege 38dae8a9abfe1b8c.
 * BD2 2026-11-16 (settlement save format 15, ruins and the clearing job): at format 14 the four runs reproduce the
 * A14-5 hashes exactly (no run records a ruin; enemy sites without an economy crumble as before), so only `version`
 * differs. Before: crossing 448922cf9e472086, developedMarch15
 * c30ce6340d6ab479, gate 709c672a94f28fcd, siege 809972ac7854fc61.
 * EAI2c 2026-11-16 (settlement save format 16, faction AI script overrides): at format 15 the four runs reproduce
 * the BD2 hashes exactly (no script changes a faction's AI), so only `version` differs. Before: crossing
 * b565db685c437f71, developedMarch15 280879575d7b465a, gate b2bb846d617949b2, siege 94c560db0f36667e.
 * EAI2a 2026-11-16 (settlement save format 17, enemy economy AI state): these maps give no faction an AI, so at
 * format 16 the four runs reproduce the EAI2c hashes exactly; only `version` differs. Before: crossing
 * 76070a3dde591f94, developedMarch15 c9504662937a156f, gate 12112f18acc37993, siege f25aa976b61faefb.
 * EAI2b 2026-11-16 (settlement save format 18, woken economies and the maintain memory): at format 17 the four runs
 * reproduce the EAI2a hashes exactly (no faction has an AI), so only `version` differs. Before: crossing
 * fcb6b8de67e7366f, developedMarch15 e392e42558c3e1f8, gate d304ebcb7514c1e8, siege 58311f150efd53f0.
 * EAI2d 2026-11-16 (settlement save format 19, wall repair): at format 18 the four runs reproduce the EAI2b hashes
 * exactly (no faction has an AI), so only `version` differs. Before: crossing 6335bd039c01fb72, developedMarch15
 * 0776cfc0391ab4ad, gate 3323ffd65086b351, siege 241534b80fcb1315.
 * EAI3a 2026-11-16 (settlement save format 20, the develop goal memory): at format 19 the four runs reproduce the
 * EAI2d hashes exactly, so only `version` differs. Before: crossing dfe54c8c7680c82d, developedMarch15
 * 6222eee3db9de5de, gate d5d69b997112cb16, siege 0d55edc7776123a2.
 * AI-RELOAD-DRIFT 2026-11-16 (settlement save format 21, saved movement memories): with the new save fields left
 * out at format 20 the four runs reproduce the EAI3a hashes exactly, so only `version`, `movementResume` and the
 * carrier `leg` entries differ. Before: crossing d8052f5861797e41, developedMarch15 921b6ac72727816a, gate
 * 36cefebd96bbcba2, siege 7df9926be8606fee.
 * EAI4c 2026-11-16 (settlement save format 23, the script goal of a faction AI): at format 22 the four runs
 * reproduce master's hashes exactly, so only `version` differs. Before: crossing 88bc9f0edf5f7000, developedMarch15
 * 01c08f23d2f92acf, gate 54bfecaf0581a7f0, siege a6a8404902f19e87.
 * EAI4b 2026-11-16 (settlement save format 24, a faction AI's own strategy memory): at format 23 the four runs
 * reproduce master's hashes exactly, so only `version` differs. Before: crossing a689d96f12865045,
 * developedMarch15 d980ec7289a011d6, gate 32e3f5acee91b50b, siege 97a29e78ffb202ba.
 * targetMilitary 2026-11-17 (settlement save format 25, a soldier's chase lock): at format 24 the four runs
 * reproduce master's hashes exactly, so only `version` differs. Before: crossing a071bf285dc366b2,
 * developedMarch15 60a07445f99ce959, gate d7e758d9b7d05d8a, siege 4241f377d4d185c5.
 * Map building availability 2026-11-17 (settlement save format 26, optional `homeBuildingRules`): at format 25
 * the four runs reproduce master's hashes exactly, so only `version` differs. Before: crossing e7a6e01173f16377,
 * developedMarch15 28576d947ab7faa0, gate 4ce2fdeeddc375ed, siege d8f24a564e78d8a0.
 * Shift queue 2026-11-17 (settlement save format 27, optional `orderQueues` and a soldier's `queue`): at format 26
 * the four runs reproduce master's hashes exactly, so only `version` differs. Before: crossing 641471da4da132ac,
 * developedMarch15 64a3061f0f20e89b, gate f868ff9399cefd7c, siege 6750b78db2e6ce0b.
 */
const BASELINE = {
  crossing: "d9aa961b0b681e91",
  developedMarch15: "fd4467be794238f2",
  gate: "01563d6043b2a8d7",
  siege: "32f1b9ec0174a74e"
} as const;
const REPLAY_TIMEOUT = 180_000;

const withSettings = async <Result>(settings: Partial<NavigationInvalidationSettings>, run: () => Promise<Result>) => {
  const previous = setNavigationInvalidation(settings);
  try {
    return await run();
  } finally {
    setNavigationInvalidation(previous);
  }
};

describe("navigation replay parity (local, global and strict mode agree with the baseline)", () => {
  it("replays the developed island march byte for byte with local and with global invalidation", async () => {
    const local = await withSettings({ mode: "local", strict: false }, () => developedMarchRun(15));
    const global = await withSettings({ mode: "global", strict: false }, () => developedMarchRun(15));
    expect(local.hash).toBe(BASELINE.developedMarch15);
    expect(global.hash).toBe(BASELINE.developedMarch15);
    expect(local.text === global.text).toBe(true);
  }, REPLAY_TIMEOUT);

  it("keeps no stale value on the developed island march (every reuse recomputed)", async () => {
    const strict = await withSettings({ mode: "local", strict: true }, () => developedMarchRun(15));
    expect(strict.hash).toBe(BASELINE.developedMarch15);
  }, REPLAY_TIMEOUT);

  it.each([
    ["gate", () => gateScenario(24, 55)],
    ["siege", () => siegeScenario(90)],
    ["crossing", () => crossingScenario(16, 50)]
  ] as const)("replays the %s motion scenario like the pre-A03 code", async (name, scenario) => {
    const hash = await withSettings({ mode: "local", strict: true }, async () => {
      const motion = scenario();
      runMotionScenario(motion);
      return hashText(JSON.stringify(motion.simulation.saveState()));
    });
    expect(hash).toBe(BASELINE[name]);
  }, REPLAY_TIMEOUT);
});
