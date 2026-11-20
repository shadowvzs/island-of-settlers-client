import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DIALOGUE_SPEED_MS_PER_CHAR } from "../../island-of-settlers-shared/src/campaign/cinematics/constants";
import { SCRIPT_LIMITS } from "../../island-of-settlers-shared/src/script/constants";
import type { ActorLook, ScriptActor } from "../../island-of-settlers-shared/src/script/types/actors";
import { actorPortraitId, scriptActorSpeakers } from "../src/app/campaign/cinematics/actor-speakers";
import { buildSpeakerPages, type SpeakLine } from "../src/app/campaign/cinematics/ui/helpers";
import { SpeakerPanel } from "../src/app/campaign/cinematics/ui/speaker-panel";
import { addSpawnActor, editedDisplayName, replaceActor, withDisplayName } from "../src/app/map-editor/script/actors";
import { tabChoices } from "../src/app/map-editor/script/picker-choices";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";
import { QuestTextFields } from "../src/app/map-editor/script/text-language-inputs";
import { messages as english } from "../src/locales/en/messages";

/** Owner 2026-11-13: the map maker names pirate and bandit actors; the speaker panel and portraits show the name. */

const i18n = setupI18n({ locale: "en", messages: { en: english } });
const spawned = (look: ActorLook, fields: Partial<ScriptActor> = {}) => {
  const { actor, script } = addSpawnActor(createEmptyMapScript("script-1"), "Raider", "region-1");
  const edited = { ...actor, look, ...fields } as ScriptActor;
  return { actor: edited, script: replaceActor(script, edited) };
};
const line = (speakerId: string): SpeakLine => ({ delayMs: 0, id: "line", kind: "speak", speakerId,
  start: "afterPrevious", text: { en: "Hand over the cargo." }, timing: "auto", waitForClick: true });

describe("actor display names in the map editor", () => {
  it("edits the look's English default for pirates and bandits and shows no name field for nation looks", () => {
    expect(editedDisplayName(spawned({ kind: "pirates" }).actor)).toEqual({ en: "Pirate" });
    expect(editedDisplayName(spawned({ kind: "bandits" }).actor)).toEqual({ en: "Bandit" });
    expect(editedDisplayName(spawned({ kind: "ownerNation" }).actor)).toBeNull();
    expect(editedDisplayName(spawned({ kind: "nation", nation: "roman" }).actor)).toBeNull();
  });

  it("stores the name the map maker types per language and drops a name emptied in every language", () => {
    const { actor } = spawned({ kind: "pirates" });
    const named = withDisplayName(actor, { en: "Redbeard", hu: "Vörösszakáll" });
    expect(named.displayName).toEqual({ en: "Redbeard", hu: "Vörösszakáll" });
    expect(editedDisplayName(named)).toEqual({ en: "Redbeard", hu: "Vörösszakáll" });
    expect(editedDisplayName({ ...named, look: { kind: "ownerNation" } } as ScriptActor), "kept after a look change")
      .toEqual({ en: "Redbeard", hu: "Vörösszakáll" });
    const cleared = withDisplayName(named, { en: " " });
    expect("displayName" in cleared).toBe(false);
    expect(editedDisplayName(cleared)).toEqual({ en: "Pirate" });
    expect(withDisplayName(actor, { en: "", hu: "Vörös" }).displayName).toEqual({ en: "", hu: "Vörös" });
  });

  it("limits the name inputs to the display name length", () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(QuestTextFields,
      { label: "Name shown to players", maxLength: SCRIPT_LIMITS.actorDisplayNameLength, onCommit: () => undefined,
        text: { en: "Pirate" } })));
    expect(markup.match(/maxLength="40"/g)).toHaveLength(markup.match(/<input/g)!.length);
    expect(markup).toContain('value="Pirate"');
  });

  it("lists a named actor in the actor picker with the name players read", () => {
    const { script } = spawned({ kind: "pirates" }, { displayName: { en: "Redbeard" } });
    const context = { i18n, locale: "en", script };
    const spec = { instanceOnly: true, kind: "actor" } as Parameters<typeof tabChoices>[1];
    expect(tabChoices("instance", spec, context).map(choice => choice.label))
      .toEqual(["Raider — shown as “Redbeard”"]);
    const plain = spawned({ kind: "ownerNation" }).script;
    expect(tabChoices("instance", spec, { ...context, script: plain }).map(choice => choice.label)).toEqual(["Raider"]);
  });
});

describe("named actors in the cinematic speaker panel", () => {
  const pirate = spawned({ kind: "pirates" },
    { displayName: { en: "Redbeard the Elder", hu: "Vörösszakáll" } }).actor;
  const bandit = { ...spawned({ kind: "bandits" }).actor, id: "actor-9" };
  const roman = { ...spawned({ kind: "ownerNation" }).actor, id: "actor-7" };
  const speakers = scriptActorSpeakers({ actors: [pirate, bandit, roman] });
  const pagesOf = (speakerId: string, language = "en", resolvePortrait: (id: string) => string | null = () => null) =>
    buildSpeakerPages({ language, lines: [line(speakerId)], msPerChar: DIALOGUE_SPEED_MS_PER_CHAR.normal,
      resolvePortrait, speakers });

  it("offers every actor with a display name as a speaker under its actor id, with its look's portrait id", () => {
    expect(speakers).toEqual([
      { id: pirate.id, name: { en: "Redbeard the Elder", hu: "Vörösszakáll" },
        portraits: { neutral: "actor-portrait:pirates" } },
      { id: "actor-9", name: { en: "Bandit" }, portraits: { neutral: "actor-portrait:bandits" } }
    ]);
    expect(actorPortraitId(roman)).toBe("actor-portrait:ownerNation");
  });

  it("shows the actor name on the name plate and in the portrait initials, in the displayed language", () => {
    expect(pagesOf(pirate.id)[0]).toMatchObject({ initials: "RT", name: "Redbeard the Elder", portraitSource: null });
    expect(pagesOf(pirate.id, "hu")[0]).toMatchObject({ initials: "V", name: "Vörösszakáll" });
    expect(pagesOf("actor-9", "hu")[0]).toMatchObject({ initials: "B", name: "Bandit" });
    expect(pagesOf("actor-7")[0]!.name, "an unnamed nation actor is no speaker").toBe("actor-7");
    const standIn = pagesOf(pirate.id, "en", id => (id === "actor-portrait:pirates" ? "/pirate.webp" : null));
    expect(standIn[0]!.portraitSource).toBe("/pirate.webp");
  });

  it("renders the name in the panel", () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(SpeakerPanel, {
      lines: [line(pirate.id)], msPerChar: DIALOGUE_SPEED_MS_PER_CHAR.normal, onAdvance: () => undefined,
      resolvePortrait: () => null, speakers, speech: { lineIndex: 0, pageIndex: 0, phase: "playing" }
    })));
    expect(markup).toContain('<p class="speaker-panel__name">Redbeard the Elder</p>');
    expect(markup).toContain(">RT<");
  });
});
