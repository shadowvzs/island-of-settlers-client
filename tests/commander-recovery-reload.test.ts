import { beforeAll, expect, it } from "vitest";

import type { CapturedGame } from "../src/app/save-store/captured-game";
import { createCommandLogSession } from "../src/app/settlement/command-log-session";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createHeldFrameJobs } from "../src/app/settlement/held-frame-jobs";
import { recoverSavedCommander } from "../src/app/settlement/server-commander-recovery";
import { createRecoveryAccountFixture } from "../tools/bench/commander-recovery-account-fixture";

let fixture: Awaited<ReturnType<typeof createRecoveryAccountFixture>>;
beforeAll(async () => { fixture = await createRecoveryAccountFixture(); });

it("retains the actual315HP server effect and identities after releasing the held precapture reload", async () => {
  const { simulation, world } = await createHeadlessIsland(fixture.game);
  const jobs = createHeldFrameJobs(() => false), release = jobs.hold();
  const session = createCommandLogSession({ simulation, bugReplay: { recording: () => false } as never }, jobs);
  session.capture({ save: [world, simulation.saveState()] } as unknown as CapturedGame);
  const recovered = recoverSavedCommander(fixture.game, fixture.commanderId);
  if (!recovered?.ok) throw new Error("Canonical recovery fixture failed");
  expect(simulation.loadState(recovered.game.settlement).ok).toBe(true);
  session.rebase("home");
  expect(simulation.commanderSnapshot()!.hp).toBe(315);
  release(); jobs.frameSeconds(.016); jobs.frameSeconds(.017);
  expect(simulation.commanderSnapshot()).toMatchObject({ id: fixture.commanderId, hp: 315, ready: true });
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(row => row.commanderId === fixture.commanderId)!;
  expect(soldier.actor).toBe(fixture.actor);
  expect(soldier.combat!.mount).toBe(fixture.mount);
  expect(saved.actors.filter(row => row.uid === fixture.actor)).toHaveLength(1);
  expect(saved.actors.filter(row => row.uid === fixture.mount)).toHaveLength(1);
  session.dispose();
});
