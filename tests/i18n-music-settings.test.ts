import { readFileSync } from "node:fs";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MUSIC_MESSAGES } from "../src/app/audio/messages";
import type { MusicTrack } from "../src/app/audio/music-catalog";
import { MUSIC_COLLECTIONS } from "../src/app/audio/music-catalog";
import {
  getMusicModeView,
  getMusicPlaybackView,
  getMusicPlaylistOptions,
  getMusicProgressView,
  getMusicStatusText,
  getMusicTrackCount,
  getMusicVolumeView,
  type MusicPlaybackView
} from "../src/app/audio/music-player-helpers";
import { MusicPlayerView, type MusicPlayerViewProps } from "../src/app/audio/music-player-panel";
import type { MusicPlayerState } from "../src/app/audio/music-player-store";
import { createMusicPlayerActions } from "../src/app/audio/use-music-player";
import { CLOUD_MESSAGES } from "../src/app/cloud/messages";
import { SETTINGS_CHROME_MESSAGES } from "../src/app/settings/chrome-messages";
import { CreditsPanel } from "../src/app/settings/credits/credits-panel";
import {
  describeLocalizedLicence,
  getCreditCategoryViews,
  getMusicLicenceLinks
} from "../src/app/settings/credits/helpers";
import { CREDITS_MESSAGES } from "../src/app/settings/credits/messages";
import {
  CREDIT_CATEGORIES,
  CREDIT_LICENCES,
  GAME_CREATOR,
  ORIGINAL_WORK
} from "../src/app/settings/credits-data";
import { DeveloperDiaryPanel } from "../src/app/settings/developer-diary/developer-diary-panel";
import { formatDiaryDate } from "../src/app/settings/developer-diary/helpers";
import { DEVELOPER_DIARY_MESSAGES } from "../src/app/settings/developer-diary/messages";
import { LANGUAGE_MESSAGES } from "../src/app/settings/language/messages";
import { WindowShortcutButton } from "../src/app/settings/window-shortcut-button";
import { renderWithI18n } from "./helpers/render-with-i18n";

vi.mock("../src/app/components/react-island", () => ({ mountReactIsland: vi.fn() }));

interface DraftEntry {
  hu: string;
  id: string;
  message: string;
}

const draft: DraftEntry[] = JSON.parse(readFileSync(
  new URL("../../docs/localization-drafts/i18n-music-settings.json", import.meta.url), "utf8"));

const collectDescriptors = (value: unknown, found: { id: string; message?: string }[] = []) => {
  if (value && typeof value === "object" && "id" in value && "message" in value) {
    found.push(value as { id: string; message?: string });
    return found;
  }
  if (value && typeof value === "object") for (const entry of Object.values(value)) collectDescriptors(entry, found);
  return found;
};

const descriptors = [
  ...collectDescriptors(MUSIC_MESSAGES),
  ...collectDescriptors(CREDITS_MESSAGES),
  ...collectDescriptors(DEVELOPER_DIARY_MESSAGES),
  ...collectDescriptors(LANGUAGE_MESSAGES.window),
  ...collectDescriptors(CLOUD_MESSAGES.slotDefaultName)
];

const hungarianCatalog = Object.fromEntries(draft.map(entry => [entry.id, entry.hu]));
const hungarian = setupI18n({ locale: "hu", messages: { hu: hungarianCatalog } });

const tracks: MusicTrack[] = [
  { collection: "roman", filename: "forum.ogg", name: "Forum", url: "/forum.ogg" },
  { collection: "neutral", name: "Harbour Lanterns", url: "/harbour.ogg" }
];
const musicState = (overrides: Partial<MusicPlayerState> = {}): MusicPlayerState => ({
  collection: "roman", currentIndex: 1, currentTime: 65, duration: 130, ended: false, loopCurrent: false,
  muted: false, paused: true, repeatPlaylist: true, status: { kind: "track", track: "Harbour Lanterns" },
  tracks, volume: .35, ...overrides
});
const noop = () => undefined;
const actions = createMusicPlayerActions(new Proxy({}, { get: () => noop }) as never);
const musicProps = (current = musicState(), i18n = hungarian): MusicPlayerViewProps => ({
  actions, collection: current.collection, currentIndex: String(current.currentIndex),
  loop: getMusicModeView(MUSIC_MESSAGES.transport.loop, current.loopCurrent, i18n), muted: current.muted,
  playback: getMusicPlaybackView(current, i18n), playlist: getMusicPlaylistOptions(current.tracks),
  progress: getMusicProgressView(current, null, i18n),
  repeat: getMusicModeView(MUSIC_MESSAGES.transport.repeat, current.repeatPlaylist, i18n),
  seekRef: { current: null }, status: getMusicStatusText(current.status, i18n),
  trackCount: getMusicTrackCount(current.tracks, i18n),
  transportDisabled: !current.tracks.length, volume: current.volume,
  volumeView: getMusicVolumeView(current, i18n), onScrub: noop, onScrubEnd: noop
});
const renderMusic = (i18n = hungarian) => renderToStaticMarkup(
  createElement(I18nProvider, { i18n }, createElement(MusicPlayerView, musicProps(musicState(), i18n))));

describe("music and settings localization draft", () => {
  it("has one draft entry for every new message, in descriptor order", () => {
    expect(descriptors).toHaveLength(draft.length);
    expect(new Set(draft.map(entry => entry.id)).size).toBe(draft.length);
    expect(draft.map(entry => entry.id)).toEqual(descriptors.map(entry => entry.id));
    expect(draft.map(entry => entry.message)).toEqual(descriptors.map(entry => entry.message));
  });

  it("keeps every Hungarian draft entry and its named placeholders", () => {
    for (const entry of draft) {
      expect(entry.hu.trim(), entry.id).not.toBe("");
      for (const placeholder of entry.message.match(/\{[^{}]+\}/g) ?? [])
        expect(entry.hu, `${entry.id} keeps ${placeholder}`).toContain(placeholder);
    }
  });

  it("keeps credits labels aligned with the English data used for CREDITS.md", () => {
    expect(CREDITS_MESSAGES.creatorRole.message).toBe(GAME_CREATOR.role);
    expect(CREDITS_MESSAGES.originalWork.message).toBe(ORIGINAL_WORK);
    for (const category of CREDIT_CATEGORIES) {
      const copy = CREDITS_MESSAGES.categories[category.id as keyof typeof CREDITS_MESSAGES.categories];
      expect(copy.title.message, category.id).toBe(category.title);
      if (category.note) expect("note" in copy ? copy.note.message : undefined, category.id).toBe(category.note);
    }
  });
});

describe("music player live labels", () => {
  const english = setupI18n({ locale: "en", messages: { hu: hungarianCatalog } });

  it("resolves playback, mode, volume and count copy through the active locale", () => {
    expect(getMusicPlaybackView(musicState(), hungarian).toggleLabel).toBe("Folytatás");
    expect(getMusicPlaybackView(musicState({ paused: false }), hungarian).toggleLabel).toBe("Szünet");
    expect(getMusicModeView(MUSIC_MESSAGES.transport.repeat, true, hungarian)).toEqual({
      label: "A lejátszási lista ismétlése", pressed: true, title: "A lejátszási lista ismétlése: be"
    });
    expect(getMusicVolumeView(musicState(), hungarian)).toMatchObject({
      muteLabel: "Zene némítása", valueText: "35 százalék", volumeText: "35%"
    });
    expect(getMusicTrackCount(tracks, hungarian)).toBe("2 szám");
    expect(getMusicProgressView(musicState(), null, hungarian).valueText).toBe("1:05 / 2:10");
  });

  it("localizes status text while keeping the track title", () => {
    expect(getMusicStatusText({ kind: "track", track: "Forum" }, hungarian)).toBe("Forum");
    expect(getMusicStatusText({ kind: "autoplayBlocked", track: "Forum" }, hungarian))
      .toBe("Forum — nyomd meg a Lejátszás gombot az indításhoz.");
    expect(getMusicStatusText({ kind: "emptyPlaylist" }, hungarian))
      .toBe("Válassz helyi hangfájlokat a lejátszási lista létrehozásához.");
  });

  it("follows a live language change and renders the same view in both locales", () => {
    expect(getMusicPlaybackView(musicState(), english).toggleLabel).toBe("Resume");
    const englishMarkup = renderMusic(english);
    expect(englishMarkup).toContain('aria-label="Music controls"');
    expect(englishMarkup).toContain('<option value="all">All music</option>');
    expect(englishMarkup).toContain("2 tracks");

    hungarian.activate("hu");
    expect(getMusicPlaybackView(musicState(), hungarian).toggleLabel).toBe("Folytatás");
    const hungarianMarkup = renderMusic(hungarian);
    expect(hungarianMarkup).toContain('aria-label="Zenevezérlők"');
    expect(hungarianMarkup).toContain('<option value="all">Minden zene</option>');
    expect(hungarianMarkup).toContain(">2 szám</small>");
    expect(hungarianMarkup).toContain('aria-label="A lejátszási lista ismétlése"');
    expect(hungarianMarkup).toContain('title="A lejátszási lista ismétlése: be"');
    expect(hungarianMarkup).toContain('aria-label="Zene hangereje"');
    expect(hungarianMarkup).toContain('aria-valuetext="35 százalék"');
  });

  it("translates collection labels but keeps track titles and filenames", () => {
    expect(MUSIC_COLLECTIONS.map(entry => hungarian._(entry.label))).toEqual([
      "Minden zene", "Római", "Viking", "Japán", "Núbiai", "Kínai", "Perzsa", "Maja", "Őslakos",
      "Semleges", "Saját helyi fájlok"
    ]);
    expect(getMusicPlaylistOptions(tracks).map(option => option.label))
      .toEqual(["01. forum.ogg", "02. Harbour Lanterns"]);
  });

  it("resolves the Main selection shortcut caption in the active locale", () => {
    const markup = renderWithI18n(createElement(WindowShortcutButton, {
      shortcut: {
        caption: SETTINGS_CHROME_MESSAGES.window.musicPlayer,
        icon: "musicPlayer",
        open: noop,
        registerOpener: noop
      }
    }), "hu");
    expect(markup).toContain('aria-label="Zenelejátszó"');
    expect(markup).toContain("<span>Zenelejátszó</span>");
  });

  it("keeps the playback labels stable when a paused track resumes", () => {
    const view: MusicPlaybackView = getMusicPlaybackView(musicState({ currentTime: 0 }), hungarian);
    expect(view.toggleLabel).toBe("Lejátszás");
  });
});

describe("credits and Game News localization", () => {
  it("renders Hungarian group headings, creator labels and licence badges", () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n: hungarian },
      createElement(CreditsPanel)));
    expect(markup).toContain('aria-label="Készítő"');
    expect(markup).toContain("Játéktervezés és fejlesztés");
    expect(markup).toContain("Zenei és hangszerlicencek");
    expect(markup).toContain("A csomagolt zenei közreműködések és a teljes hangszerlicenc:");
    expect(markup).toContain("Készítette: fabiotambone");
    expect(markup).toContain("Harmadik féltől származó 3D modellek, a játékhoz igazítva.");
    expect(markup).toContain("eredeti munka az Island of Settlershez");
    expect(markup).toContain(">Zenei közreműködések</a>");
    expect(markup).toContain(">Hangszerlicenc</a>");
  });

  it("translates generic licence labels but leaves proper licence names", () => {
    const original = CREDIT_CATEGORIES.flatMap(category => category.entries)
      .find(entry => entry.licence === "original")!;
    const owner = CREDIT_CATEGORIES.flatMap(category => category.entries)
      .find(entry => entry.title === "Worker and horse characters")!;
    expect(describeLocalizedLicence(original, hungarian)).toBe("eredeti munka az Island of Settlershez");
    expect(describeLocalizedLicence(owner, hungarian)).toBe("Saját tulajdon (Tripo3D)");
    expect(describeLocalizedLicence(owner)).toBe("Owner-owned (Tripo3D)");
    expect(CREDIT_LICENCES.mit.name).toBe("MIT");
    expect(getCreditCategoryViews(hungarian).find(category => category.id === "tools")).toMatchObject({
      note: "A játék készítéséhez használtuk; nem része a kiadásnak.",
      title: "Eszközök"
    });
    expect(getMusicLicenceLinks(hungarian).map(link => link.label))
      .toEqual(["Zenei közreműködések", "Hangszerlicenc"]);
  });

  it("localizes the Game News intro and date while keeping authored article text", () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, { i18n: hungarian },
      createElement(DeveloperDiaryPanel)));
    expect(markup).toContain("Rövid napló arról, mi új a szigeteken.");
    expect(markup).toContain("Music, new materials and room to explore");
    expect(formatDiaryDate("2026-10-15", "hu")).not.toBe(formatDiaryDate("2026-10-15", "en"));
    expect(formatDiaryDate("2026-10-15", "hu")).toContain("2026");
  });

  it("keeps the English source as the fallback", () => {
    const english = setupI18n({ locale: "en", messages: {} });
    expect(getMusicPlaybackView(musicState(), english).toggleLabel).toBe("Resume");
    expect(getMusicTrackCount(tracks, english)).toBe("2 tracks");
    expect(getCreditCategoryViews(english).find(category => category.id === "models")?.title).toBe("3D models");
  });
});
