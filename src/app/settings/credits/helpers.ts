import type { I18n, MessageDescriptor } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  CREDIT_CATEGORIES,
  CREDIT_LICENCES,
  type CreditCategory,
  type CreditEntry,
  type CreditLicenceId,
  getAttributionText,
  requiresAttribution
} from "../credits-data";
import { CREDITS_MESSAGES } from "./messages";

/** Text that links to `href` when there is one; otherwise plain text. */
export interface CreditLinkView {
  className: string;
  href?: string;
  text: string;
}

export interface CreditEntryView {
  attribution?: string;
  author: CreditLinkView;
  key: string;
  licence: CreditLinkView;
  title: CreditLinkView;
  usedFor: string;
}

export interface CreditCategoryView {
  entries: readonly CreditEntryView[];
  headingId: string;
  id: string;
  note?: string;
  title: string;
}

export interface CreditLicenceLinkView {
  href: string;
  label: string;
}

const LINK_CLASS = "credits-window__link";

/** Group headings and notes by category id; data titles remain the English source for CREDITS.md. */
const CATEGORY_MESSAGES: Readonly<Record<string, { note?: MessageDescriptor; title: MessageDescriptor }>> = {
  fonts: CREDITS_MESSAGES.categories.fonts,
  libraries: CREDITS_MESSAGES.categories.libraries,
  models: CREDITS_MESSAGES.categories.models,
  original: CREDITS_MESSAGES.categories.original,
  sky: CREDITS_MESSAGES.categories.sky,
  sounds: CREDITS_MESSAGES.categories.sounds,
  terrain: CREDITS_MESSAGES.categories.terrain,
  tools: CREDITS_MESSAGES.categories.tools
};

const LICENCE_MESSAGES: Partial<Record<CreditLicenceId, MessageDescriptor>> = {
  "nasa-media": CREDITS_MESSAGES.licence.nasaMedia,
  owner: CREDITS_MESSAGES.licence.owner,
  system: CREDITS_MESSAGES.licence.system
};

/** The licence badge: proper licence names stay as they are; generic labels follow the locale. */
export const describeLocalizedLicence = (entry: CreditEntry, i18n?: I18n) => {
  if (entry.licence === "original") return translateMessage(i18n, CREDITS_MESSAGES.originalWork);
  const descriptor = LICENCE_MESSAGES[entry.licence];
  const name = descriptor ? translateMessage(i18n, descriptor) : CREDIT_LICENCES[entry.licence].name;
  return entry.madeWith ? `${name} (${entry.madeWith})` : name;
};

const toEntryView = (entry: CreditEntry, i18n?: I18n): CreditEntryView => ({
  attribution: requiresAttribution(entry) ? getAttributionText(entry) : undefined,
  author: { className: LINK_CLASS, href: entry.authorUrl, text: entry.author },
  key: entry.title,
  licence: {
    className: `credits-entry__licence credits-entry__licence--${entry.licence}`,
    href: CREDIT_LICENCES[entry.licence].url,
    text: describeLocalizedLicence(entry, i18n)
  },
  title: { className: "credits-entry__title", href: entry.sourceUrl, text: entry.title },
  usedFor: entry.usedFor
});

const toCategoryView = (category: CreditCategory, i18n?: I18n): CreditCategoryView => {
  const copy = CATEGORY_MESSAGES[category.id];
  return {
    entries: category.entries.map(entry => toEntryView(entry, i18n)),
    headingId: `credits-category-${category.id}`,
    id: category.id,
    note: copy?.note ? translateMessage(i18n, copy.note) : category.note,
    title: copy ? translateMessage(i18n, copy.title) : category.title
  };
};

/** Every credits group in data order, prepared for the view in the active locale. */
export const getCreditCategoryViews = (i18n?: I18n) => CREDIT_CATEGORIES.map(category => toCategoryView(category, i18n));

/** Bundled music credits and the full instrument licence, served as files beside the game. */
export const getMusicLicenceLinks = (i18n?: I18n): readonly CreditLicenceLinkView[] => [
  {
    href: new URL("../../../../assets/audio/LICENSE.txt?no-inline", import.meta.url).href,
    label: translateMessage(i18n, CREDITS_MESSAGES.music.credits)
  },
  {
    href: new URL("../../../../assets/audio/midi/FLUIDR3-LICENSE.txt?no-inline", import.meta.url).href,
    label: translateMessage(i18n, CREDITS_MESSAGES.music.instrumentLicence)
  }
];
