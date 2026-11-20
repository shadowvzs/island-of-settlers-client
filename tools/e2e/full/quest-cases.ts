import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import type { PlayerProgress } from "../../../src/shared/progression/player-progress";
import { homeTutorialQuest } from "../../../src/shared/quests/home-quest-book";
import { activeHomeQuestId, finishedHomeQuestIds } from "../../../src/shared/quests/home-quests";
import type { GameSaveV1 } from "../../../src/shared/settlement/game-save";
import { choosePlot, clickGround, connectBuildingUi, selectBuilding } from "./natural-ui-helpers";
import { requireQuestPrerequisite } from "./quest-prerequisites";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
type ClaimedQuest = {
  id: string;
  kind: "tutorial" | "daily";
  experience: number;
  beforeXp: number;
  afterXp: number;
};

const openJournal = async (page: Page) => {
  const journal = page.getByRole("dialog", { name: "Quests", exact: true });
  if (!(await journal.isVisible())) {
    // The Main selection panel shares the bottom-right HUD corner and can intercept the HUD button.
    const closeMain = page.getByRole("button", { name: "Close settlement window", exact: true });
    if (await closeMain.isVisible()) await closeMain.click();
    await page.getByRole("button", { name: /^Quests(?::|$)/ }).click();
  }
  await journal.waitFor({ state: "visible" });
  return journal;
};

import { confirmImport, openMenuAction } from "../../bench/save-helpers";

/** Account facts come from the real portable export, without a private account mutation API. */
const captureProgress = async (page: Page) => {
  const action = await openMenuAction(page, "Export game");
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  await action.click();
  const download = await pending,
    stream = await download.createReadStream();
  assert(stream, "Export game did not provide readable checkpoint bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks),
    game = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
  assert(game.player, "Player progression is absent from the current game checkpoint");
  const close = page.getByRole("button", { name: "Close development tools panel", exact: true });
  if (await close.isVisible()) await close.click();
  return { bytes, game, player: game.player as PlayerProgress };
};

const waitForObjective = async (page: Page, id: string, seconds = 300) => {
  const journal = await openJournal(page),
    samples: { elapsedMs: number; text: string; ready: boolean }[] = [];
  const started = Date.now();
  let previous = "";
  while (Date.now() - started < seconds * 1000) {
    const entry = journal.locator(`[data-quest-id='${id}']`);
    assert((await entry.count()) === 1, `Quest ${id} disappeared before its claim`);
    await entry.click();
    const text = await entry.innerText();
    const action = journal
      .locator(".quest-window__claim")
      .getByRole("button", { name: /^(Claim|Deliver)$/ });
    const ready = await action.isEnabled();
    if (text !== previous) {
      samples.push({ elapsedMs: Date.now() - started, text, ready });
      previous = text;
    }
    if (ready) return samples;
    await page.waitForTimeout(750);
  }
  throw new Error(
    `Quest ${id} made insufficient natural progress within ${seconds}s: ${JSON.stringify(samples)}`
  );
};

const claimOnce = async (
  page: Page,
  id: string,
  kind: ClaimedQuest["kind"],
  experience: number
) => {
  const before = await captureProgress(page);
  assert(
    !before.game.settlement.buildings.some((building) => building.construction < 1),
    "Exactly-once XP ledger requires finished construction; another completion could award concurrent XP"
  );
  const journal = await openJournal(page),
    entry = journal.locator(`[data-quest-id='${id}']`);
  await entry.click();
  await journal
    .locator(".quest-window__claim")
    .getByRole("button", { name: /^(Claim|Deliver)$/ })
    .click();
  await entry.waitFor({ state: "detached", timeout: 15_000 });
  const after = await captureProgress(page);
  assert.equal(
    after.player.experience - before.player.experience,
    experience,
    "Quest XP paid an unexpected amount"
  );
  if (kind === "tutorial") {
    assert.equal(finishedHomeQuestIds(after.player.questBook).filter((questId) => questId === id).length, 1);
    assert.notEqual(after.player.questBook && activeHomeQuestId(after.player.questBook), id);
  } else
    assert.equal(after.player.quests.filter((quest) => quest.id === id && quest.done).length, 1);
  await journal.getByRole("button", { name: "Close quests window", exact: true }).click();
  await openJournal(page);
  assert.equal(
    await journal.locator(`[data-quest-id='${id}']`).count(),
    0,
    "A claimed quest became claimable again after reopening"
  );
  return {
    id,
    kind,
    experience,
    beforeXp: before.player.experience,
    afterXp: after.player.experience
  };
};

const prepareTutorialConstruction = async (page: Page, type: number) => {
  const existing = await page.evaluate(
    (typeId) =>
      (window as any).__settlement.simulation
        .buildings()
        .find((building: any) => building.typeId === typeId),
    type
  );
  if (existing)
    return { action: "Observe existing real construction/ownership", uid: existing.uid };
  requireQuestPrerequisite(
    [17, 20, 29, 33, 35].includes(type),
    `Prerequisite: tutorial building ${type} needs its dedicated natural supply-chain journey`
  );
  const journal = await openJournal(page);
  await journal.getByRole("button", { name: "Close quests window", exact: true }).click();
  await selectBuilding(page, type);
  const plot = await choosePlot(page, type);
  await clickGround(page, plot);
  await page.waitForFunction(
    (typeId) =>
      (window as any).__settlement.simulation
        .buildings()
        .some((building: any) => building.typeId === typeId),
    type,
    { timeout: 10_000 }
  );
  const placed = await page.evaluate(
    (typeId) =>
      (window as any).__settlement.simulation
        .buildings()
        .find((building: any) => building.typeId === typeId),
    type
  );
  assert(
    placed.construction < 1,
    "Tutorial building was unexpectedly complete immediately after placement"
  );
  const road = await connectBuildingUi(page, placed.uid);
  return {
    action: "Placed building and connected dirt road through UI; no grants",
    uid: placed.uid,
    plot,
    road
  };
};

export const runQuestCases = async (page: Page, runCase: RunCase) => {
  const claimed: ClaimedQuest[] = [];
  await runCase(
    "E2E-12-tutorial-progress-claim",
    "Eligible tutorial advances naturally and pays its reward once",
    async () => {
      const initial = await captureProgress(page),
        tutorial = initial.player.questBook;
      const quest = homeTutorialQuest(tutorial && activeHomeQuestId(tutorial));
      requireQuestPrerequisite(
        quest && tutorial,
        "Prerequisite: this home checkpoint needs an active tutorial"
      );
      requireQuestPrerequisite(
        initial.game.settlement.buildings.some((building) => building.typeId === 0),
        "Prerequisite: tutorial progression is restricted to the home island"
      );
      let preparation: unknown = { action: "Observe existing objective progress" };
      if (quest.objective.kind === "build")
        preparation = await prepareTutorialConstruction(page, quest.objective.building);
      if (!["build", "produce"].includes(quest.objective.kind)) {
        const journal = await openJournal(page);
        await journal.locator(`[data-quest-id='${quest.id}']`).click();
        requireQuestPrerequisite(
          await journal
            .locator(".quest-window__claim")
            .getByRole("button", { name: "Claim", exact: true })
            .isEnabled(),
          `Prerequisite: tutorial ${quest.id}/${quest.objective.kind} requires its actual journey event`
        );
      }
      const samples = await waitForObjective(page, quest.id);
      const result = await claimOnce(page, quest.id, "tutorial", quest.experience);
      claimed.push(result);
      return {
        initial: {
          active: quest.id,
          baseline: tutorial.quests[quest.id]?.baseline ?? 0,
          counters: tutorial.counters
        },
        preparation,
        samples,
        claim: result,
        partialProgressObserved: samples.some((sample) => {
          const match = sample.text.match(/(\d+)\s*\/\s*(\d+)/);
          return match && Number(match[1]) > 0 && Number(match[1]) < Number(match[2]);
        }),
        scope:
          "Current eligible tutorial only; later tutorial objectives require their journey checkpoints"
      };
    }
  );
  await runCase(
    "E2E-12-daily-progress-claim",
    "Eligible production daily advances and pays exactly once",
    async () => {
      const initial = await captureProgress(page);
      const quest =
        initial.player.quests.find(
          (candidate) =>
            !candidate.done &&
            candidate.kind === "produce" &&
            candidate.progress >= candidate.amount
        ) ??
        initial.player.quests.find(
          (candidate) =>
            !candidate.done &&
            candidate.kind === "produce" &&
            ["logs", "water", "planks"].includes(candidate.ware)
        );
      requireQuestPrerequisite(
        quest,
        "Prerequisite: no eligible ready/wood/water/plank production daily in this checkpoint; retain its actual quest roll"
      );
      const producers: Record<string, number> = { logs: 17, water: 35, planks: 33 };
      requireQuestPrerequisite(
        quest.progress >= quest.amount ||
          initial.game.settlement.buildings.some(
            (building) => building.typeId === producers[quest.ware] && building.construction === 1
          ),
        `Prerequisite: daily ${quest.id} needs a naturally working ${quest.ware} producer and inputs`
      );
      // A natural woodcutter on the 512 map produces roughly one log per 40 s; 8 logs need >300 s.
      const samples = await waitForObjective(page, quest.id, 420);
      const result = await claimOnce(page, quest.id, "daily", quest.experience);
      claimed.push(result);
      return {
        initial: quest,
        samples,
        claim: result,
        partialProgressObserved: samples.some((sample) => {
          const match = sample.text.match(/(\d+)\s*\/\s*(\d+)/);
          return match && Number(match[1]) > 0 && Number(match[1]) < Number(match[2]);
        }),
        scope:
          "Production daily only; delivery costs and midnight rollover require separate fixtures"
      };
    }
  );
  await runCase(
    "E2E-12-claim-reload",
    "Real export/import reload retains claims without duplicate XP",
    async () => {
      requireQuestPrerequisite(
        claimed.length > 0,
        "Prerequisite: no quest claim passed in this run"
      );
      const before = await captureProgress(page);
      const action = await openMenuAction(page, "Import game"),
        chooser = page.waitForEvent("filechooser");
      const reload = page.waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 120_000
      });
      await action.click();
      await (
        await chooser
      ).setFiles({
        name: "quest-claims-checkpoint.json",
        mimeType: "application/json",
        buffer: before.bytes
      });
      await confirmImport(page);
      await reload;
      await page.waitForFunction(() => (window as any).__islandReady === true, null, {
        timeout: 180_000
      });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
      const journal = await openJournal(page);
      for (const quest of claimed)
        assert.equal(await journal.locator(`[data-quest-id='${quest.id}']`).count(), 0);
      const after = await captureProgress(page);
      assert.equal(
        after.player.questDay,
        before.player.questDay,
        "Local midnight crossed; daily replay needs a separate clock fixture"
      );
      assert.equal(
        after.player.experience,
        before.player.experience,
        "Reload duplicated quest XP or unrelated work changed this ledger"
      );
      for (const quest of claimed) {
        if (quest.kind === "tutorial")
          assert.equal(finishedHomeQuestIds(after.player.questBook).filter((id) => id === quest.id).length, 1);
        else
          assert.equal(
            after.player.quests.filter((candidate) => candidate.id === quest.id && candidate.done)
              .length,
            1
          );
      }
      return {
        claimed,
        beforeXp: before.player.experience,
        afterXp: after.player.experience,
        restoredActualUiExport: true,
        repeatedClaimUnavailable: true
      };
    }
  );
};
