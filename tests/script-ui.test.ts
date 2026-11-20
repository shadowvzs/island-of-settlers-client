import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ScriptUiEffect } from "../../island-of-settlers-shared/src/script/engine/ui-effects";
import type { UiTargetKind } from "../../island-of-settlers-shared/src/script/types/ui";
import { tutorialUi } from "../../island-of-settlers-shared/tests/script-fixtures";
import { createExternalStore } from "../src/app/components/ui-store";
import { colonyLostPopup, lostColonies, rememberColonies } from "../src/app/script/ui/colony-lost-notice";
import { createHighlightStore } from "../src/app/script/ui/highlight-store";
import { createScriptPresentation } from "../src/app/script/ui/script-presentation";
import { uiAnchorChain } from "../src/app/script/ui/ui-anchors";
import { createUiTargetOpeners, openerOf, type UiTargetPorts } from "../src/app/script/ui/ui-targets";
import { Messages } from "../src/app/settlement-ui/messages/message-view";
import { createOpenRequest } from "../src/app/settlement-ui/open-request";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type { SettlementScriptWindows } from "../src/app/settlement-ui/script-windows";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { createBattleMessage } from "../src/shared/progression/battle-messages";
import { addInboxMails, createScriptMail, validInboxMails } from "../src/shared/progression/inbox-mails";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

/** TRG9: script UI targets, presentation effects, `scriptUiAck`, deferral, mails and the colony-lost notice. */

const worldFixture = () => {
  const size = 40;
  return { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }, script: tutorialUi()
  } as unknown as WorldData;
};

const scripted = () => {
  const world = worldFixture();
  return { sim: createSettlementSimulation({ roads: createRoadNetwork(world), world }), world };
};

const ticks = (sim: ReturnType<typeof scripted>["sim"], count: number) => {
  for (let tick = 0; tick < count; tick++) sim.update(0.05);
};

/** Every UI target kind (compile-time exhaustive through `satisfies`). */
const TARGET_KINDS = Object.keys({
  building: true, colonyTracker: true, expeditionPlanner: true, fleet: true, gemShop: true, inventory: true,
  language: true, mainPanel: true, market: true, messages: true, overview: true, quests: true, settings: true,
  talents: true, terrainSurvey: true, tradeOffice: true
} satisfies Record<UiTargetKind, true>) as UiTargetKind[];

const fakeWindows = (): SettlementScriptWindows => ({
  close: vi.fn(), closeBuildingDetails: vi.fn(), closeMainPanel: vi.fn(), closeMessages: vi.fn(),
  closeQuests: vi.fn(), focusBuildingDetails: vi.fn(() => true), focusMainPanelView: vi.fn(() => true),
  open: vi.fn(() => true), openMessages: vi.fn(), openQuests: vi.fn()
});

const fakePorts = (windows = fakeWindows()): UiTargetPorts & { windowsFake: SettlementScriptWindows } => ({
  inventory: { close: vi.fn(), open: vi.fn() }, language: { close: vi.fn(), open: vi.fn() },
  settings: { close: vi.fn(), open: vi.fn() }, windows: () => windows, windowsFake: windows
});

const targetOf = (kind: UiTargetKind) => {
  if (kind === "building") return { handle: { generation: 0, id: 12, space: "building" as const }, kind };
  if (kind === "quests") return { kind, questId: "farm.wheat" };
  if (kind === "mainPanel") return { kind, view: "notices" as const };
  if (kind === "settings") return { kind, section: "sound" as const };
  return { kind } as never;
};

describe("TRG9 UI target registry", () => {
  it("has an opener for every listed target; each opens or brings to front through its feature's own path", () => {
    const ports = fakePorts();
    const openers = createUiTargetOpeners(ports);
    expect(Object.keys(openers).sort()).toEqual([...TARGET_KINDS].sort());
    const results = Object.fromEntries(TARGET_KINDS.map(kind => {
      const target = targetOf(kind);
      return [kind, openerOf(openers, target).open(target)];
    }));
    expect(results).toEqual({ ...Object.fromEntries(TARGET_KINDS.map(kind => [kind, true])), terrainSurvey: false });
    const windows = ports.windowsFake;
    expect(windows.focusBuildingDetails).toHaveBeenCalledWith(12);
    expect(windows.openQuests).toHaveBeenCalledWith("farm.wheat");
    expect(windows.focusMainPanelView).toHaveBeenCalledWith("notices");
    expect(windows.focusMainPanelView).toHaveBeenCalledWith("ships");
    expect(ports.settings.open).toHaveBeenCalledWith("sound");
    expect(ports.inventory.open).toHaveBeenCalledOnce();
    expect(ports.language.open).toHaveBeenCalledOnce();
    expect(vi.mocked(windows.open).mock.calls.map(call => call[0]).sort()).toEqual(
      ["colonyTracker", "expeditionPlanner", "gemShop", "market", "overview", "talents", "tradeOffice"]);
  });

  it("a building target opens details only through the UI-only focus; a gone or non-building handle is refused", () => {
    const ports = fakePorts();
    const opener = createUiTargetOpeners(ports).building;
    expect(opener.open({ handle: null, kind: "building" })).toBe(false);
    expect(opener.open({ handle: { generation: 0, id: 3, space: "actor" }, kind: "building" })).toBe(false);
    vi.mocked(ports.windowsFake.focusBuildingDetails).mockReturnValueOnce(false);
    expect(opener.open({ handle: { generation: 0, id: 4, space: "building" }, kind: "building" })).toBe(false);
  });

  it("refuses everything before the settlement HUD exists", () => {
    const openers = createUiTargetOpeners({ ...fakePorts(), windows: () => undefined });
    expect(openers.quests.open({ kind: "quests", questId: null })).toBe(false);
    expect(openers.overview.open({ kind: "overview" })).toBe(false);
  });
});

describe("TRG9 simulation boundary", () => {
  it("UI effects come from the outbox and never change the island state or the script hash", () => {
    const drained = scripted(), kept = scripted();
    ticks(drained.sim, 3);
    ticks(kept.sim, 3);
    const effects = drained.sim.takeScriptUiEffects();
    expect(effects.map(effect => effect.kind)).toEqual(["openUi", "highlightUi"]);
    expect(drained.sim.takeScriptUiEffects()).toHaveLength(0);
    expect(drained.sim.script()!.engine.hash()).toBe(kept.sim.script()!.engine.hash());
    expect(JSON.stringify(drained.sim.saveState())).toBe(JSON.stringify(kept.sim.saveState()));
  });

  it("scriptUiAck is a recorded command; the waiting highlight survives a reload and the ack resumes the run", () => {
    expect(REPLAY_COMMANDS).toContain("scriptUiAck");
    const { sim, world } = scripted();
    ticks(sim, 5);
    const waiting = sim.scriptWaitingHighlights();
    expect(waiting.map(entry => entry.anchor)).toEqual(["bottomBar.build"]);
    const loaded = createSettlementSimulation({ roads: createRoadNetwork(world), world });
    expect(loaded.loadState(JSON.parse(JSON.stringify(sim.saveState())))).toEqual({ ok: true });
    expect(loaded.scriptWaitingHighlights()).toEqual(waiting);
    expect(loaded.takeScriptUiEffects()).toHaveLength(0);
    expect(loaded.scriptUiAck("ui:99:s4:1")).toBe(false);
    expect(loaded.scriptUiAck(waiting[0]!.effectId)).toBe(true);
    expect(sim.scriptUiAck(waiting[0]!.effectId)).toBe(true);
    ticks(loaded, 2);
    ticks(sim, 2);
    expect(loaded.scriptWaitingHighlights()).toHaveLength(0);
    const next = loaded.takeScriptUiEffects().filter(effect => effect.kind === "highlightUi");
    expect(next.map(effect => effect.kind === "highlightUi" && effect.highlight.anchor)).toEqual(["build.tab.food"]);
    expect(loaded.script()!.engine.hash()).toBe(sim.script()!.engine.hash());
  });
});

const presentationWith = (hidden: { value: boolean }) => {
  const clock = { now: 0 };
  const highlights = createHighlightStore();
  const ports = {
    acknowledge: vi.fn(() => true), deliverMail: vi.fn(), focusCamera: vi.fn(), highlights,
    hudHidden: () => hidden.value, log: vi.fn(), now: () => clock.now, openers: createUiTargetOpeners(fakePorts()),
    playAudio: vi.fn()
  };
  return { clock, highlights, ports, presentation: createScriptPresentation(ports) };
};

const highlight = (anchor: string, waiting: boolean, until: "clicked" | "seconds" = "clicked"): ScriptUiEffect => ({
  highlight: { anchor, effectId: `ui:1:${anchor}:0`, seconds: until === "seconds" ? 2 : null, text: null, until,
    waiting }, kind: "highlightUi"
});

describe("TRG9 presentation port", () => {
  it("defers UI effects while a cinematic hides the HUD, keeps their order and drops them after 60 s", () => {
    const hidden = { value: true };
    const { clock, highlights, ports, presentation } = presentationWith(hidden);
    presentation.receive([{ kind: "openUi", target: { kind: "inventory" } }, highlight("hud.quests", false)]);
    presentation.receive([{ kind: "sendMail", mail: { attachments: null, body: { en: "b" }, date: 1, id: "mail:x",
      title: { en: "t" } } }]);
    expect(ports.deliverMail).toHaveBeenCalledOnce();
    presentation.update();
    expect(presentation.pending()).toBe(2);
    expect(highlights.list()).toHaveLength(0);
    hidden.value = false;
    presentation.update();
    expect(presentation.pending()).toBe(0);
    expect(highlights.list().map(entry => entry.anchor)).toEqual(["hud.quests"]);
    hidden.value = true;
    presentation.receive([{ kind: "clearHighlights" }]);
    clock.now = 61_000;
    presentation.update();
    expect(presentation.pending()).toBe(0);
    expect(ports.log).toHaveBeenCalledWith("deferred clearHighlights dropped after 60 s");
    expect(highlights.list()).toHaveLength(1);
  });

  it("a click on the anchor or its declared fallback acknowledges a waiting highlight once", () => {
    const { ports, presentation, highlights } = presentationWith({ value: false });
    expect(uiAnchorChain("build.tab.food")).toEqual(["build.tab.food", "bottomBar.build"]);
    presentation.receive([highlight("build.tab.food", true), highlight("hud.quests", false)]);
    presentation.click("bottomBar.menu");
    expect(ports.acknowledge).not.toHaveBeenCalled();
    presentation.click("bottomBar.build");
    expect(ports.acknowledge).toHaveBeenCalledWith("ui:1:build.tab.food:0");
    expect(highlights.list().map(entry => entry.anchor)).toEqual(["hud.quests"]);
    presentation.click("hud.quests");
    expect(ports.acknowledge).toHaveBeenCalledOnce();
    expect(highlights.list()).toHaveLength(0);
  });

  it("waiting highlights follow the run state; seconds highlights expire; clear keeps waiting ones", () => {
    const { clock, highlights, presentation } = presentationWith({ value: false });
    const waiting = highlight("bottomBar.build", true);
    presentation.syncWaiting([waiting.kind === "highlightUi" ? waiting.highlight : never()]);
    presentation.receive([highlight("hud.talents", false, "seconds"), { kind: "clearHighlights" }]);
    expect(highlights.list().map(entry => entry.anchor)).toEqual(["bottomBar.build"]);
    presentation.receive([highlight("hud.talents", false, "seconds")]);
    clock.now = 2500;
    presentation.update();
    expect(highlights.list().map(entry => entry.anchor)).toEqual(["bottomBar.build"]);
    presentation.syncWaiting([]);
    expect(highlights.list()).toHaveLength(0);
  });
});

function never(): never {
  throw new Error("unreachable");
}

const scriptMail = (id: string) => createScriptMail({ attachments: { goods: [{ amount: 12, ware: "logs" }] },
  body: { en: "The harbour master thanks you.", hu: "A kikötőmester köszöni." }, date: Date.UTC(2026, 10, 11),
  id, title: { en: "A letter from the coast", hu: "Levél a partról" } }, "Seabright");

describe("TRG9 inbox mails and the colony-lost notice", () => {
  it("stores script mails idempotently beside battle reports and validates both", () => {
    const report = createBattleMessage({ kind: "colony", island: { name: "Stormcairn", seed: 3 }, date: 10,
      nation: "roman", buildings: [], goods: {}, experience: 20 });
    const first = addInboxMails([report], [scriptMail("mail:uid:t1:1.s2")])!;
    expect(first.map(mail => mail.id)).toEqual(["mail:uid:t1:1.s2", report.id]);
    expect(addInboxMails(first, [scriptMail("mail:uid:t1:1.s2")])).toBeNull();
    expect(validInboxMails(first)).toBe(true);
    expect(validInboxMails([{ ...scriptMail("mail:x"), title: { hu: "no english" } }])).toBe(false);
    expect(validInboxMails([{ ...scriptMail("oops"), kind: "script" }])).toBe(false);
  });

  it("renders a script mail in the inbox and the opener token selects it", () => {
    const store = createSettlementUiStore();
    const older = scriptMail("mail:uid:t1:1.s2"), newer = { ...scriptMail("mail:uid:t1:2.s2"),
      title: { en: "Newest" } };
    store.update({ player: { messages: [newer, older] } as unknown as SettlementPlayerSummary });
    const request = createOpenRequest();
    request.set({ opened: 1, subjectId: older.id });
    const markup = renderWithI18n(createElement(Messages, {
      request, store, visibility: createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true })
    }));
    expect(markup).toContain("<h2>A letter from the coast</h2>");
    expect(markup).toContain('<p class="message-window__mail-body">The harbour master thanks you.</p>');
    expect(markup).toContain("Seabright · ");
    expect(markup).toContain("<h3>Goods mentioned</h3>");
    const hungarian = renderWithI18n(createElement(Messages, {
      request, store, visibility: createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true })
    }), "hu");
    expect(hungarian).toContain("<h3>Említett áruk</h3>");
    expect(hungarian).not.toContain("Softwood logs");
  });

  it("announces a colony gone since the last session once, and never one the client still sees", () => {
    const north = { id: 4, name: "North Reach", ore: "iron" }, south = { id: 7, name: "South Cay", ore: "gold" };
    const memory = rememberColonies({ announced: [], seen: [] }, [north, south], []);
    const lost = lostColonies(memory, [south]);
    expect(lost).toEqual([north]);
    const after = rememberColonies(memory, [south], lost);
    expect(lostColonies(after, [south])).toEqual([]);
    expect(lostColonies({ ...after, seen: [north, south] }, [south])).toEqual([]);
    const i18n = createTestI18n();
    const popup = colonyLostPopup(lost, i18n);
    expect(popup.title).toBe("Colony abandoned");
    expect(popup.message).toBe("North Reach has expired. Its remaining settlers, troops and goods returned home.");
    expect(colonyLostPopup([north, south], i18n).message.split("\n\n")).toHaveLength(2);
    expect(colonyLostPopup(lost, createTestI18n("hu")).title).toBe("Gyarmat feladva");
    expect(colonyLostPopup(lost, createTestI18n("de")).title).toBe("Kolonie aufgegeben");
  });
});

describe("script audio effects in the presentation", () => {
  it("plays sounds and music at once, also while the HUD is hidden and other effects wait", () => {
    const hidden = { value: true };
    const { ports, presentation } = presentationWith(hidden);
    const sound: ScriptUiEffect = { kind: "playSound", sound: { id: "sound:thunder", kind: "catalog" }, volume: 1 };
    const stop: ScriptUiEffect = { fadeOutSeconds: 1, kind: "stopMusic" };
    presentation.receive([{ kind: "clearHighlights" }, sound, stop]);
    expect(ports.playAudio.mock.calls.map(call => call[0])).toEqual([sound, stop]);
    expect(presentation.pending()).toBe(1);
  });
});
