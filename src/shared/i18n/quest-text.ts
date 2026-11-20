import type { I18n } from "@lingui/core";
import { splitContentId, toContentId } from "@shared/catalog";
import { nationQuestWare } from "@shared/catalog/balance";

import {
  type QuestTextContext, resolveQuestText, type TextCatalogPort
} from "../../../../island-of-settlers-shared/src/script/text/index";
import type { QuestText } from "../../../../island-of-settlers-shared/src/script/types/quest-text";
import { SOURCE_LOCALE } from "./locales";

/** Who reads a quest text: everything of the resolver's context that does not come from the locale. */
export type QuestTextViewer = Pick<QuestTextContext, "contentAlias" | "evaluate" | "nation">;

const catalogPorts = new WeakMap<I18n, TextCatalogPort>();

/** The active Lingui catalog as the shared resolver's catalog port (one port per I18n instance). */
const catalogPort = (i18n: I18n) => {
  let port = catalogPorts.get(i18n);
  if (port) return port;
  port = {
    has: key => Object.hasOwn(i18n.messages, key),
    translate: (key, english, values) =>
      i18n._(values ? { id: key, message: english, values } : { id: key, message: english })
  };
  catalogPorts.set(i18n, port);
  return port;
};

/**
 * Quest data stores the Roman drink chain; every nation reads it as its own raw ware and drink, on every map kind
 * (owner 2026-11-11), exactly like today's tutorial and daily titles.
 */
const nationContentAlias = (nation: string) => (contentId: string) => {
  const parts = splitContentId(contentId);
  return parts?.kind === "ware" ? toContentId("ware", nationQuestWare(parts.key, nation)) : contentId;
};

/** A viewer with a nation names that nation's drink wares unless it brings its own alias. */
const withNationAlias = (viewer: QuestTextViewer): QuestTextViewer => {
  if (!viewer.nation || viewer.contentAlias) return viewer;
  return { ...viewer, contentAlias: nationContentAlias(viewer.nation) };
};

/**
 * The shared quest text context of the active locale. Without an I18n instance (tests, the server bundle) every
 * text is its English source.
 */
export const questTextContext = (i18n?: I18n, viewer: QuestTextViewer = {}): QuestTextContext => {
  const reader = withNationAlias(viewer);
  if (!i18n) return { ...reader, locale: SOURCE_LOCALE };
  return { ...reader, catalog: catalogPort(i18n), locale: i18n.locale };
};

/** A quest text of map data in the active language: inline text, then the Lingui id, then inline English. */
export const displayQuestText = (text: QuestText, i18n?: I18n, viewer?: QuestTextViewer) =>
  resolveQuestText(text, questTextContext(i18n, viewer));
