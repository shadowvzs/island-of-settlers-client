import { expect, it } from "vitest";

import { createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { changeLines, mapsGainingWarnings } from "../src/app/admin/settings/confirmation-helpers";
import {
  draftIssues, isTitleFileName, rewardsChoice, sameSettings, storedSwitch, switchState, withPreset, withRewards,
  withSwitch, withTitleFile
} from "../src/app/admin/settings/helpers";
import { settingsViewModel } from "../src/app/admin/settings/view-model";
import { replaceAccount, statusAction, userRows } from "../src/app/admin/users/helpers";

const TODAY = DEFAULT_ONLINE_SETTINGS;
const offline = (settings: GameSettings) => ({ ...cloneGameSettings(settings), connectivity: "offline" as const });

it("shows D1/D2 on today's settings: autosave forced on, slots unavailable, stored values kept", () => {
  const stored = cloneGameSettings(TODAY);
  stored.saving = { autosave: false, slots: true };
  expect(switchState(stored, "autosave")).toMatchObject({ checked: true, disabled: true });
  expect(switchState(stored, "autosave").reason).toMatch(/^Online games with a home island save automatically/);
  expect(switchState(stored, "slots")).toMatchObject({ checked: false, disabled: true });
  expect(storedSwitch(stored, "autosave")).toBe(false);
  expect(storedSwitch(stored, "slots")).toBe(true);
});

it("D3–D8 and D1b reach the rows with their reasons", () => {
  const manual = offline(TODAY);
  manual.saving = { autosave: false, slots: false };
  expect(switchState(manual, "slots")).toMatchObject({ checked: true, disabled: true });
  const noFog = withSwitch(TODAY, "fogOfWar", false);
  expect(switchState(noFog, "explorationExpeditions").reason).toBe("Nothing to explore while fog of war is off.");
  const noHome = withSwitch(TODAY, "homeIsland", false);
  expect(noHome.afterMap).toBe("exitChoice");
  expect(switchState(noHome, "trade"))
    .toMatchObject({ checked: false, disabled: true, reason: "Needs a home island." });
  expect(switchState(noHome, "market").reason).toBe("Market goods move to and from the home island.");
  expect(switchState(offline(TODAY), "chat").reason).toBe("Needs online mode.");
  const paidStory = withRewards(noHome, "on");
  expect(switchState(paidStory, "slots").reason).toMatch(/^Online campaigns with rewards/);
  const view = settingsViewModel(undefined as never, noHome, "server");
  expect(view.play.afterMapChoices[0]).toMatchObject({ disabled: true, title: "There is no home island to sail to." });
});

it("edits are immutable, rewards are tri-state and presets keep the mode on a server", () => {
  const changed = withSwitch(TODAY, "chat", false);
  expect(TODAY.online.chat).toBe(true);
  expect(changed.online.chat).toBe(false);
  expect(sameSettings(TODAY, cloneGameSettings(TODAY))).toBe(true);
  expect(sameSettings(TODAY, changed)).toBe(false);
  expect(rewardsChoice(TODAY)).toBe("auto");
  expect(rewardsChoice(withRewards(TODAY, "off"))).toBe("off");
  expect(withRewards(withRewards(TODAY, "on"), "auto").progression.rewards).toBeUndefined();
  const titled = withTitleFile(TODAY, "music", "theme.ogg");
  expect(withPreset(titled, "story", true))
    .toMatchObject({ connectivity: "online", titleScreen: { music: "theme.ogg" } });
  expect(withPreset(titled, "story", false).connectivity).toBe(GAME_SETTINGS_PRESETS.story.connectivity);
});

it("player troop sight: on by default, a hinted Features row, stored only when changed", () => {
  expect(storedSwitch(TODAY, "playerTroopsSightOnly")).toBe(true);
  expect(switchState(TODAY, "playerTroopsSightOnly")).toMatchObject({ checked: true, disabled: false });
  const off = withSwitch(TODAY, "playerTroopsSightOnly", false);
  expect(TODAY.playerTroopsSightOnly).toBeUndefined();
  expect(off.playerTroopsSightOnly).toBe(false);
  expect(storedSwitch(off, "playerTroopsSightOnly")).toBe(false);
  expect(changeLines(TODAY, off).map(line => line.id)).toEqual(["playerSightOff"]);
  const rows = settingsViewModel(undefined as never, off, "server").features.rows;
  const row = rows.find(entry => entry.key === "playerTroopsSightOnly")!;
  expect(rows.at(-1)).toBe(row);
  expect(row).toMatchObject({ checked: false, disabled: false, label: "Player troops act only on what they see" });
  expect(row.hint).toMatch(/^On \(fair\): player soldiers target only enemies they see/);
  // The other feature rows stay without a tooltip; the title page's menu switch keeps its own.
  expect(rows.filter(entry => entry.hint)).toEqual([row]);
  expect(settingsViewModel(undefined as never, TODAY, "server").titlePage.menuBeforePlay.hint)
    .toMatch(/^On: players get the title menu/);
});

it("title file names: plain names with allowed extensions; empty removes the field", () => {
  expect(isTitleFileName("background", "")).toBe(true);
  expect(isTitleFileName("background", "harbour.webm")).toBe(true);
  expect(isTitleFileName("background", "../x.png")).toBe(false);
  expect(isTitleFileName("music", "theme.png")).toBe(false);
  const bad = withTitleFile(TODAY, "background", "sub/x.png");
  expect(draftIssues(bad).blocking).toBe(true);
  expect(withTitleFile(withTitleFile(TODAY, "music", "a.ogg"), "music", "").titleScreen).toBeUndefined();
});

it("confirmation lines and campaign maps gaining mode warnings", () => {
  const noHome = withSwitch(TODAY, "homeIsland", false);
  expect(changeLines(TODAY, cloneGameSettings(TODAY))).toEqual([]);
  expect(changeLines(TODAY, noHome)[0]).toEqual({
    id: "homeRemoved", text: "Home islands are kept but not used; players start at the campaign selection."
  });
  const map = createCampaignMap("m1", "c1", { id: "slot-1" } as never);
  map.unlock = [{ kind: "homeBuilding" } as never];
  expect(mapsGainingWarnings([map], TODAY, noHome)).toBe(0);
  expect(mapsGainingWarnings([map], noHome, TODAY)).toBe(1);
});

it("users: one status action per account and the list update", () => {
  const player = { displayName: "P", id: "p", lastSeenAt: null, role: "player" as const, status: "active" as const };
  expect(statusAction(player)).toBe("ban");
  expect(statusAction({ ...player, role: "admin" })).toBeNull();
  expect(statusAction({ ...player, status: "banned" })).toBe("unban");
  expect(statusAction({ ...player, status: "deletion_pending" })).toBeNull();
  expect(userRows([player], "never")[0]).toMatchObject({ action: "ban", lastSeen: "never" });
  expect(replaceAccount([player], { ...player, status: "banned" })[0]!.status).toBe("banned");
});
