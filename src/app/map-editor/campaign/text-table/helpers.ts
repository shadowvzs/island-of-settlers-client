import type { I18n } from "@lingui/core";

import type { Campaign, CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { type AppLocale, isAppLocale, LANGUAGE_OPTIONS } from "../../../../shared/i18n/locales";
import { translateMessage } from "../../../../shared/i18n/translate";
import { type CampaignTextEntry, collectCampaignTexts, missingTextLanguages } from "../campaign-texts";
import { CAMPAIGN_CHECK_LANGUAGES, TEXT_CELL_ID_PREFIX } from "../constants";
import { displayText } from "../helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";

/** One language column of the translation table. */
export interface TextColumn {
  label: string;
  language: string;
  locale: AppLocale | null;
}

export interface TextCell {
  /** DOM id of the input (a Check jump focuses it). */
  id: string;
  /** Accessible name: "Quest intro: title (Magyar)". */
  label: string;
  language: string;
  missing: boolean;
  value: string;
}

export interface TextRow {
  cells: TextCell[];
  id: string;
  label: string;
  multiline: boolean;
}

/** The texts of one document (the campaign or a map) with its count of missing translations. */
export interface TextGroup {
  id: string;
  missing: number;
  missingLabel: string;
  rows: TextRow[];
  title: string;
}

export const textCellId = (textId: string, language: string) => `${TEXT_CELL_ID_PREFIX}:${textId}:${language}`;

/** EN / HU / DE: every game language, English first. */
export const textTableColumns = (languages: readonly string[] = CAMPAIGN_CHECK_LANGUAGES): TextColumn[] =>
  languages.map(language => ({
    label: LANGUAGE_OPTIONS.find(option => option.locale === language)?.label ?? language.toUpperCase(),
    language,
    locale: isAppLocale(language) ? language : null
  }));

/** What a row is, in the editor's language ("Name", "Quest story-intro: title", "Arrival: line 2"). */
export const textRowLabel = (text: CampaignTextEntry, i18n?: I18n) => {
  const { kind, position, subject } = text;
  if (kind === "campaignDescription") return translateMessage(i18n, M.fields.description);
  if (kind === "campaignName" || kind === "mapName") return translateMessage(i18n, M.fields.name);
  return translateMessage(i18n, M.textTable[kind], { position, subject });
};

const textRow = (text: CampaignTextEntry, columns: readonly TextColumn[], i18n: I18n | undefined): TextRow => {
  const missing = new Set(missingTextLanguages(text, columns.map(column => column.language)));
  const label = textRowLabel(text, i18n);
  return {
    cells: columns.map(({ label: language, language: code }) => ({
      id: textCellId(text.id, code),
      label: translateMessage(i18n, M.textTable.cell, { field: label, language }),
      language: code,
      missing: missing.has(code),
      value: text.text[code] ?? ""
    })),
    id: text.id,
    label,
    multiline: text.multiline
  };
};

const missingCount = (rows: readonly TextRow[]) =>
  rows.reduce((sum, row) => sum + row.cells.filter(cell => cell.missing).length, 0);

/** Ids of the texts that lack a translation in any game language (the "only missing" filter's snapshot). */
export const missingTextIds = (campaign: Campaign, maps: readonly CampaignMap[]): ReadonlySet<string> =>
  new Set(collectCampaignTexts(campaign, maps)
    .filter(text => missingTextLanguages(text, CAMPAIGN_CHECK_LANGUAGES).length > 0).map(text => text.id));

/**
 * The table body: one group per document (the campaign, then each map by name), rows limited to `visibleIds`
 * when the "only missing" filter is on. Groups without a visible row are left out.
 */
export const textTableGroups = (
  campaign: Campaign, maps: readonly CampaignMap[], i18n?: I18n, visibleIds: ReadonlySet<string> | null = null
): TextGroup[] => {
  const language = (i18n?.locale ?? "en").split("-")[0] ?? "en";
  const columns = textTableColumns();
  const texts = collectCampaignTexts(campaign, maps).filter(text => !visibleIds || visibleIds.has(text.id));
  const documents = [
    { id: "campaign", mapId: null as string | null, title: translateMessage(i18n, M.validation.campaign) },
    ...maps.map(map => ({ id: map.id, mapId: map.id, title: displayText(map.name, language, map.id) }))
  ];
  return documents.flatMap(({ id, mapId, title }) => {
    const rows = texts.filter(text => text.mapId === mapId).map(text => textRow(text, columns, i18n));
    if (!rows.length) return [];
    const missing = missingCount(rows);
    return [{ id, missing, missingLabel: translateMessage(i18n, M.textTable.missingCount, { count: missing }), rows,
      title }];
  });
};

/** The filter snapshot with the text a Check jump points at kept visible. */
export const visibleTextIds = (filterIds: ReadonlySet<string> | null, jumpTextId: string | undefined) => {
  if (!filterIds || !jumpTextId || filterIds.has(jumpTextId)) return filterIds;
  return new Set([...filterIds, jumpTextId]);
};
