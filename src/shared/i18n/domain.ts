import type { I18n, MessageDescriptor } from "@lingui/core";
import {
  banditEntries, banditEntry, type BanditSiteRef, buildingEntry, catalogEntries, settlerEntries, type SettlerEntry,
  soldierEntries, type SoldierEntry, soldierEntry, toContentId, wareEntries, wareEntry
} from "@shared/catalog";

import { contentDisplayName } from "../../../../island-of-settlers-shared/src/script/text/index";
import type { ContentNameForm } from "../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { MilitaryTroopType } from "../settlement/military-combat-rules";
import { contentDescriptor } from "./content-text";
import { DOMAIN_MESSAGES } from "./domain-messages";
import { questTextContext } from "./quest-text";
import { translateMessage } from "./translate";

const MATERIAL_MESSAGES: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.names.material;
const NATION_MESSAGES: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.names.nation;
const STATUS_EXACT: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.status.exact;
const STATUS_SHIP_LABEL: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.status.shipLabel;
const STATUS_SHIP_PHASE: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.status.shipPhase;
export const DOMAIN_SHIP_TERMS = DOMAIN_MESSAGES.status.shipTerms;
export const DOMAIN_STATUS_PATTERNS = DOMAIN_MESSAGES.status.patterns;
const STATUS_PATTERNS = DOMAIN_STATUS_PATTERNS;
const REFUSAL_EXACT: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.refusal.exact;
const REFUSAL_PATTERNS = DOMAIN_MESSAGES.refusal.patterns;
const APP_EXACT: Readonly<Record<string, MessageDescriptor>> = DOMAIN_MESSAGES.app.exact;
const APP_PATTERNS = DOMAIN_MESSAGES.app.patterns;
const OFFLINE_MESSAGES = DOMAIN_MESSAGES.app.offline;
const TUTORIAL = DOMAIN_MESSAGES.tutorial;

/**
 * Resolve a domain descriptor: the one `translateMessage` fallback (active catalog when supplied, otherwise the
 * English source with simple plurals, including `#`). Kept as the domain modules' name for it.
 */
export const translateDomainMessage = translateMessage;

const capitalize = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
const formatNumber = (value: number, i18n?: I18n) =>
  new Intl.NumberFormat(i18n?.locale ?? "en-US").format(Math.round(value));

/** A catalog name through the shared bridge; `count` 1 is the singular, any other amount the plural. */
const contentName = (contentId: string, form: ContentNameForm, count: number, i18n?: I18n, nation?: string) =>
  contentDisplayName(contentId, { count, form }, questTextContext(i18n, { nation }));

/** The canonical display name of a ware (content catalog); unknown save ids keep the humanized id. */
export const displayWareName = (ware: string, i18n?: I18n) =>
  contentName(toContentId("ware", ware), "name", 1, i18n);

/** The ware name in the right number ("Sword"/"Swords"), without the count itself. */
export const displayWareNameForCount = (ware: string, count: number, i18n?: I18n) =>
  contentName(toContentId("ware", ware), "plural", count, i18n);

/** "<count> <ware name>" with grouped digits and the right number. */
export const formatDomainWareCount = (ware: string, count: number, i18n?: I18n) =>
  contentName(toContentId("ware", ware), "counted", count, i18n);

/** A goods list for notices: "100 Softwood logs, 5 Swords". */
export const describeDomainWares = (goods: Readonly<Record<string, number>>, i18n?: I18n) =>
  Object.entries(goods).map(([ware, count]) => formatDomainWareCount(ware, count, i18n)).join(", ");

export const displayMaterialName = (material: string, i18n?: I18n) => {
  const descriptor = MATERIAL_MESSAGES[material];
  return descriptor ? translateDomainMessage(i18n, descriptor) : material;
};

/** A building's nation-specific name (catalog `text.variants`), falling back to the type id when unknown. */
export const displayBuildingName = (typeId: number, nation?: string, i18n?: I18n) => {
  const entry = buildingEntry(typeId);
  return entry ? contentName(entry.id, "name", 1, i18n, nation) : `Building ${typeId}`;
};

/** A building name in a count context; English pluralizes the noun, Hungarian does not. */
export const displayBuildingNameForCount = (
  typeId: number, count: number, nation?: string, i18n?: I18n
) => {
  const entry = buildingEntry(typeId);
  return entry ? contentName(entry.id, "plural", count, i18n, nation) : `Building ${typeId}`;
};

let settlersByJobSpelling: ReadonlyMap<string, SettlerEntry> | null = null;
/** Settler entries by job string, also in the lower-case spelling of older status/action sentences ("geologist"). */
const settlerByJobSpelling = (job: string) => {
  settlersByJobSpelling ??= new Map(settlerEntries().flatMap(entry =>
    [[entry.settler.job, entry], [entry.settler.job.toLowerCase(), entry]]));
  return settlersByJobSpelling.get(job);
};

/** The job's catalog name; unknown jobs keep their text. */
export const displayJobName = (job: string, i18n?: I18n) => {
  const entry = settlerByJobSpelling(job);
  return entry ? translateDomainMessage(i18n, contentDescriptor(entry.text.name)) : job;
};

/** The nation's troop name (catalog `soldier:*` name variants `<nation>.singular|plural`, else the Roman roster). */
export const displayTroopName = (
  nation: string, type: MilitaryTroopType, plural = false, i18n?: I18n
) => contentName(toContentId("soldier", type), "plural", plural ? 2 : 1, i18n, nation);

/** Generic troop label for defeated enemies whose nation is unknown. */
export const displayGenericTroopName = (type: MilitaryTroopType, i18n?: I18n) =>
  translateDomainMessage(i18n, contentDescriptor(soldierEntry(type)!.text.name));

export const displayNationName = (nation: string, i18n?: I18n) => {
  const descriptor = NATION_MESSAGES[nation];
  return descriptor ? translateDomainMessage(i18n, descriptor) : capitalize(nation);
};

/** A bandit difficulty label ("Medium", "Hard", "Very hard": the `bandit:*` tier texts); other text stays. */
export const displayBanditTier = (tier: string, i18n?: I18n) => {
  const site = banditEntries().find(entry => entry.bandit.tier === tier);
  return site ? translateDomainMessage(i18n, contentDescriptor(site.text.variants!.tier!)) : tier;
};

/** The enemy site's name, following the same layout rules as `banditSiteName` (content catalog texts). */
export const displayBanditSiteName = (
  { code, layout }: BanditSiteRef, enclosure?: "building", i18n?: I18n
) => {
  const site = banditEntry(code) ?? banditEntries().at(-1)!;
  const tower = site.bandit.models[layout]?.kind === "tower";
  const variants = site.text.variants!;
  if (tower) return translateDomainMessage(i18n, contentDescriptor(variants.tower!));
  return translateDomainMessage(i18n, contentDescriptor(enclosure ? variants.enclosure! : site.text.name));
};

/** English building names (every type, retired ones included, and every nation name; all unique) → descriptor. */
const ENGLISH_BUILDING_NAMES = new Map<string, MessageDescriptor>();
for (const entry of catalogEntries()) if (entry.kind === "building")
  for (const text of [entry.text.name, ...Object.values(entry.text.variants ?? {})])
    ENGLISH_BUILDING_NAMES.set(text.en, contentDescriptor(text));

const ENGLISH_WARE_NAMES = new Map<string, string>();
for (const entry of wareEntries()) ENGLISH_WARE_NAMES.set(entry.text.name.en.toLowerCase(), entry.key);

export const displayBuildingNameText = (name: string, i18n?: I18n) => {
  const descriptor = ENGLISH_BUILDING_NAMES.get(name);
  return descriptor ? translateDomainMessage(i18n, descriptor) : name;
};

const localizeWareList = (text: string, i18n?: I18n) => {
  const separator = text.includes(" and ") && !text.includes(", ") ? " and " : ", ";
  const parts = text.split(separator);
  const localized = parts.map(part => {
    const match = /^([\d,.]+) (.+)$/.exec(part);
    if (!match) return undefined;
    const count = Number(match[1]!.replaceAll(",", ""));
    const ware = ENGLISH_WARE_NAMES.get(match[2]!.toLowerCase());
    if (!Number.isFinite(count) || !ware) return undefined;
    const name = displayWareNameForCount(ware, count, i18n);
    const cased = match[2] === match[2]!.toLowerCase() ? name.toLowerCase() : name;
    return `${formatNumber(count, i18n)} ${cased}`;
  });
  return localized.every((part): part is string => part !== undefined)
    ? localized.join(separator === " and " && i18n?.locale === "hu" ? " és " : separator) : undefined;
};

const EXACT_MESSAGES = new Map<string, MessageDescriptor>();
for (const source of [STATUS_EXACT, STATUS_SHIP_LABEL, STATUS_SHIP_PHASE, REFUSAL_EXACT, APP_EXACT])
  for (const [text, descriptor] of Object.entries(source)) EXACT_MESSAGES.set(text, descriptor);

const exactTranslation = (text: string) => EXACT_MESSAGES.get(text);

const translatedStatus = (text: string, i18n?: I18n): string => translateDomainText(text, i18n);

/** Translate a simulation status/refusal or an application notice. Unmatched text stays as-is. */
const translateStatusPattern = (text: string, i18n?: I18n): string | undefined => {
  let match = /^(.*) \((\d+)%\)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.withPercent, {
    percent: match[2], status: translatedStatus(match[1]!, i18n)
  });

  match = /^Waiting for (.+)$/.exec(text);
  if (match) {
    const body = match[1]!;
    const choice = /^(\d+) (.+?) \((\d+) incoming\)$/.exec(body);
    if (choice) {
      const ware = ENGLISH_WARE_NAMES.get(choice[2]!.toLowerCase());
      if (ware) return translateDomainMessage(i18n, STATUS_PATTERNS.incomingChoice, {
        amount: choice[1],
        incoming: choice[3],
        ware: displayWareNameForCount(ware, Number(choice[1]), i18n)
      });
    }
    const requirements = body.split("; ").map(entry => {
      const parsed = /^([\d,.]+) (.+?) \((\d+)\/([\d,.]+) ready, (\d+) incoming\)$/.exec(entry);
      if (!parsed) return undefined;
      const ware = ENGLISH_WARE_NAMES.get(parsed[2]!.toLowerCase());
      if (!ware) return undefined;
      return translateDomainMessage(i18n, STATUS_PATTERNS.inputRequirement, {
        amount: parsed[1], incoming: parsed[5], ready: parsed[3],
        ware: displayWareNameForCount(ware, Number(parsed[1]!.replaceAll(",", "")), i18n)
      });
    });
    if (requirements.length && requirements.every((entry): entry is string => entry !== undefined))
      return translateDomainMessage(i18n, STATUS_PATTERNS.waitingForInputs, { missing: requirements.join("; ") });
    if (wareEntry(body)) return translateDomainMessage(i18n, STATUS_PATTERNS.waitingForTool, {
      tool: displayWareName(body, i18n)
    });
  }

  match = /^Needs one of: (.+)$/.exec(text);
  if (match) {
    const choices = match[1]!.split(" / ").map(entry => {
      const parsed = /^(\d+) (.+?) \((\d+) incoming\)$/.exec(entry);
      const ware = parsed ? ENGLISH_WARE_NAMES.get(parsed[2]!.toLowerCase()) : undefined;
      if (!parsed || !ware) return undefined;
      return translateDomainMessage(i18n, STATUS_PATTERNS.incomingChoice, {
        amount: parsed[1], incoming: parsed[3], ware: displayWareNameForCount(ware, Number(parsed[1]), i18n)
      });
    });
    if (choices.length && choices.every((entry): entry is string => entry !== undefined))
      return translateDomainMessage(i18n, STATUS_PATTERNS.needsOneOf, { choices: choices.join(" / ") });
  }

  match = /^(\d+)\/(\d+) soldiers(?: · (\d+) arriving| · Waiting for stored soldiers)?$/.exec(text);
  if (match) {
    const values = { stationed: match[1], target: match[2], travelling: match[3] ?? "" };
    if (match[3]) return translateDomainMessage(i18n, STATUS_PATTERNS.soldiersArriving, values);
    if (text.endsWith("Waiting for stored soldiers"))
      return translateDomainMessage(i18n, STATUS_PATTERNS.soldiersWaiting, values);
    return translateDomainMessage(i18n, STATUS_PATTERNS.soldiers, values);
  }

  match = /^Leveling tile (\d+)\/(\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.levelingTile, {
    current: match[1], total: match[2]
  });

  match = /^Recruiting (\d+) recruits?: (carriers bring the equipment|a settler is on the way|equipping inside)$/.exec(text);
  if (match) {
    if (match[2] === "carriers bring the equipment")
      return translateDomainMessage(i18n, STATUS_PATTERNS.recruitingCollect, { count: match[1] });
    if (match[2] === "a settler is on the way")
      return translateDomainMessage(i18n, STATUS_PATTERNS.recruitingSettler, { count: match[1] });
    return translateDomainMessage(i18n, STATUS_PATTERNS.recruitingEquip, { count: match[1] });
  }

  match = /^Enemy fort · (\d+) defenders?$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.hostileFort, { count: match[1] });

  match = /^Undefended · walls ([\d,]+) \/ ([\d,]+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.hostileWalls, {
    hp: formatNumber(Number(match[1]!.replaceAll(",", "")), i18n),
    maximum: formatNumber(Number(match[2]!.replaceAll(",", "")), i18n)
  });

  match = /^(.+) · (.+) · (\d+) defenders? · capacity (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.banditFort, {
    capacity: match[4], count: match[3], name: displayBanditSiteNameText(match[2]!, i18n),
    tier: displayBanditTier(match[1]!, i18n)
  });

  match = /^(.+) · Undefended · walls ([\d,]+) \/ ([\d,]+) · capacity (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.banditWalls, {
    capacity: match[4], hp: formatNumber(Number(match[2]!.replaceAll(",", "")), i18n),
    maximum: formatNumber(Number(match[3]!.replaceAll(",", "")), i18n),
    tier: displayBanditTier(match[1]!, i18n)
  });

  match = /^(.+) · Destroyed · burning down · capacity (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.banditDestroyed, {
    capacity: match[2], tier: displayBanditTier(match[1]!, i18n)
  });

  match = /^(.+) · Undefended · capacity (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.banditUndefended, {
    capacity: match[2], tier: displayBanditTier(match[1]!, i18n)
  });

  match = /^Harbour (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.harbourNumber, { id: match[1] });
  match = /^Expedition (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.expeditionNumber, { id: match[1] });
  match = /^Ship (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.shipNumber, { id: match[1] });
  match = /^Boarding (\d+)\/(\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.boarding, {
    aboard: match[1], total: match[2]
  });
  return undefined;
};
const translateAppPattern = (text: string, i18n?: I18n): string | undefined => {
  let match = /^([\d,]+) soldiers called to the rally banner\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.soldiersCalled, { count: match[1] });
  match = /^Rally banner planted\. ([\d,]+) soldiers (attack the building it marks|march to it)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n,
    match[2] === "march to it" ? APP_PATTERNS.rallyPlantedMarch : APP_PATTERNS.rallyPlantedBuilding,
    { count: match[1] });
  match = /^([\d,]+) soldiers entering the garrison\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.infantryEntering, { count: match[1] });
  match = /^(.+) destroyed! It burns down\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.fortDestroyed, {
    building: displayBuildingNameText(match[1]!, i18n)
  });
  match = /^(.+) has no defenders left: your soldiers attack its walls\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.fortLost, {
    building: displayBuildingNameText(match[1]!, i18n)
  });
  match = /^(.+) is conquered!$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.colonyConquered, { island: match[1] });
  match = /^(.+): adventure won!$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.adventureWon, { island: match[1] });
  match = /^The reward ship brings (.+) from the adventure\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.rewardShip, {
    wares: localizeWareList(match[1]!, i18n) ?? match[1]
  });
  match = /^(.+) expired; its remaining settlers, troops and goods returned home\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.colonyExpiredHome, { island: match[1] });
  match = /^(.+) expired; its remaining units and goods returned to the home harbour\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.colonyExpiredHarbour, { island: match[1] });
  match = /^(.+) expired; all remaining units and goods returned to the home harbour\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.colonyExpiredHarbour, { island: match[1] });
  match = /^Ship requested: arrives in (.+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.shipRequested, { duration: match[1] });
  match = /^([\d,]+) soldiers sailed home from the colony\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.soldiersSailedHome, { count: match[1] });
  match = /^Supply ship from home: (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.supplyShip, {
    wares: localizeWareList(match[1]!, i18n) ?? match[1]
  });
  match = /^Resource ship from (.+): (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.resourceShip, {
    island: match[1], wares: localizeWareList(match[2]!, i18n) ?? match[2]
  });
  match = /^Ore ship sailed home with (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.oreShip, {
    wares: localizeWareList(match[1]!, i18n) ?? match[1]
  });
  match = /^The server did not confirm (?:this claim|the adventure reward): (.+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.claimNotConfirmed, { reason: match[1] });
  match = /^Needs (.+) in storage$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.questNeedsWare, {
    ware: localizeWareList(match[1]!, i18n) ?? match[1]
  });
  match = /^Produce ([\d,]+) more (.+) first$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.produceMore, {
    count: match[1], ware: localizeWareList(match[2]!, i18n) ?? match[2]
  });
  match = /^Built ([\d,]+) finished buildings? with roads\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.buildAll, { count: match[1] });
  match = /^(.*) cannot reach its destination; goods are retained\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.navigationFailure, {
    job: displayJobName(match[1]!, i18n)
  });
  match = /^Scenario completed — ([\d,]+) coin reward\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.scenarioCompletedCoins, { coins: match[1] });
  match = /^([\d,]+) gems granted\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.gemsGranted, { gems: match[1] });
  match = /^([\d,]+) gold coins added to the headquarters\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.goldGranted, { coins: match[1] });
  match = /^Player level (\d+) → (\d+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.playerLevel, {
    after: match[2], before: match[1]
  });
  match = /^Added ([\d,]+) outputs to ([\d,]+) buildings\.(.*)$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.addedOutputs, {
    buildings: match[2], detail: match[3]!.trim() ? ` ${translatedStatus(match[3]!.trim(), i18n)}` : "",
    items: match[1]
  });
  match = /^Already at maximum player level (\d+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.maxPlayerLevel, { level: match[1] });
  match = /^Ship arriving in (.+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.shipArriving, { duration: match[1] });
  match = /^Skipped: (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.buildAllSkipped, {
    reasons: match[1]!.split("; ").map(reason => {
      const entry = /^(.+) \((.+)\)$/.exec(reason);
      if (!entry) return translatedStatus(reason, i18n);
      return `${displayBuildingNameText(entry[1]!, i18n)} (${translatedStatus(entry[2]!, i18n)})`;
    }).join("; ")
  });
  match = /^No hand cart granted: every storage already keeps (\d+) hand carts \(carts on the road included\)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.handcartRefused, { limit: match[1] });
  match = /^A hand cart added to the (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.handcartGrantedOne, { storages: match[1] });
  match = /^([\d,]+) hand carts added to the (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.handcartGrantedMany, {
    count: match[1], storages: match[2]
  });
  match = /^Enemy (.+) \(rank (\d+)\) spawned\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.enemySpawned, {
    rank: match[2], troop: displayTroopNameText(match[1]!, i18n)
  });
  match = /^(.+) \(rank (\d+)\) added to the home garrison\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.troopGranted, {
    rank: match[2], troop: displayTroopNameText(match[1]!, i18n)
  });
  match = /^(.+) raised to level (\d+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.upgradedTo, {
    building: displayBuildingNameText(match[1]!, i18n), level: match[2]
  });
  match = /^Road upgraded to (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.roadUpgraded, { label: match[1] });
  match = /^No connected previous-tier road to upgrade, or insufficient (.+)\. Upgrade one tier at a time\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.roadUpgradeRefused, { label: match[1] });
  match = /^The colony on (.+) ended\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, OFFLINE_MESSAGES.colonyEnded, { island: match[1] });
  match = /^Your storages gained (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, OFFLINE_MESSAGES.gains, {
    wares: localizeWareList(match[1]!, i18n) ?? match[1]
  });
  match = /^You earned ([\d,]+) experience\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, OFFLINE_MESSAGES.experience, { experience: match[1] });
  match = /^While you were away \((.+)\): (.+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, OFFLINE_MESSAGES.summary, {
    duration: match[1], parts: match[2]
  });
  match = /^Offline production for (.+) was discarded; calendar deadlines advanced to now\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, OFFLINE_MESSAGES.discarded, { duration: match[1] });
  return undefined;
};
const translateRefusalPattern = (text: string, i18n?: I18n): string | undefined => {
  let match = /^This quarry needs a (.+) deposit on the island$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.quarryStoneDeposit, {
    stone: displayWareName(match[1]!, i18n)
  });
  match = /^This colony requires producers for its (.+) and (.+) resource pair$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.colonyMaterialProducers, {
    stone: displayMaterialName(match[2]!, i18n), wood: displayMaterialName(match[1]!, i18n)
  });
  match = /^Talent (.+) requires level (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.talentRequiresLevel, {
    id: match[1], level: match[2]
  });
  match = /^Talent (.+) requires (\d+) points in tier (\d+) of this branch$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.talentRequiresTier, {
    id: match[1], points: match[2], tier: match[3]
  });
  match = /^Talent (.+) requires (\d+) branch points$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.talentRequiresBranch, {
    id: match[1], points: match[2]
  });
  match = /^Requires level (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.requiresLevel, { level: match[1] });
  match = /^Requires (\d+) idle settlers \((\d+) available\)$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.requiresIdleSettlers, {
    available: match[2], required: match[1]
  });
  match = /^Requires (\d+) points in tier (\d+) of this branch$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.requiresTierPoints, {
    points: match[1], tier: match[2]
  });
  match = /^Requires (\d+) points in this branch$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.requiresBranchPoints, { points: match[1] });
  match = /^You already have (\d+) active offers$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.activeOfferLimit, { limit: match[1] });
  match = /^Unlocks at player level (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.unlocksAtLevel, { level: match[1] });
  match = /^Needs (\d+) more gems$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.needsGems, { count: match[1] });
  match = /^(.+) unlocks at player level (\d+)$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.wareLevelLocked, {
      level: match[2], ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^(.+) cannot be traded$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.wareNotTradable, {
      ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^Not enough (.+) on this island \(missing (\d+)\)$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.notEnoughOnIsland, {
      missing: match[2], ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^Not enough free (.+): needs (\d+), (\d+) free$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.notEnoughStock, {
      amount: match[2], free: match[3], ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^Trading keeps at least (\d+) (.+) in stock \(protected\)$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[2]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.tradeProtectedFloor, {
      floor: match[1], ware: ware ? displayWareName(ware, i18n) : match[2]
    });
  }
  match = /^Request exceeds free storage for (.+): (\d+) asked, room for (\d+)$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.requestCapacity, {
      amount: match[2], room: match[3], ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^Storage for (.+) is full$/.exec(text);
  if (match) {
    const ware = ENGLISH_WARE_NAMES.get(match[1]!.toLowerCase());
    return translateDomainMessage(i18n, REFUSAL_PATTERNS.storageFull, {
      ware: ware ? displayWareName(ware, i18n) : match[1]
    });
  }
  match = /^Needs (.+) in connected storage\.$/.exec(text);
  if (match) {
    const wares = localizeWareList(match[1]!, i18n);
    if (wares) return translateDomainMessage(i18n, REFUSAL_PATTERNS.upgradeNeedsWares, { wares });
  }
  match = /^Missing (.+?)(; (.+) reserved for queued recruits)?$/.exec(text);
  if (match) {
    const wares = localizeWareList(match[1]!, i18n);
    if (wares) {
      const missing = translateDomainMessage(i18n, REFUSAL_PATTERNS.tavernMissing, { wares });
      const reserved = match[3] ? localizeWareList(match[3], i18n) : undefined;
      return reserved ? missing + translateDomainMessage(i18n, REFUSAL_PATTERNS.reservedRecruits, {
        wares: reserved
      }) : missing;
    }
  }
  match = /^Requires level (\d+)$/.exec(text);
  if (match) return translateDomainMessage(i18n, REFUSAL_PATTERNS.requiresLevel, { level: match[1] });

  match = /^(.+) dispatched from storage\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.surveyDispatched, {
    job: displayJobName(match[1]!, i18n)
  });
  match = /^(.+) dispatched\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, APP_PATTERNS.jobDispatched, {
    job: displayJobName(match[1]!, i18n)
  });
  match = /^(.+) travelling$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.jobTravelling, {
    job: displayJobName(match[1]!, i18n)
  });
  match = /^Choose a site for (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.chooseBuildingSite, {
    building: displayBuildingNameText(match[1]!, i18n)
  });
  match = /^Choose a connected road endpoint for the (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.chooseSurveyEndpoint, {
    job: displayJobName(match[1]!, i18n)
  });
  match = /^Planned (.+)\. Connect its road endpoint\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.plannedBuilding, {
    building: displayBuildingNameText(match[1]!, i18n)
  });
  match = /^(.+) is complete\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.buildingComplete, {
    building: displayBuildingNameText(match[1]!, i18n)
  });
  match = /^(.+): (.+)\.$/.exec(text);
  if (match) return translateDomainMessage(i18n, STATUS_PATTERNS.buildingStatus, {
    building: displayBuildingNameText(match[1]!, i18n), status: translatedStatus(match[2]!, i18n)
  });
  return undefined;
};
/** Translate a simulation status/refusal or an application notice. Unmatched text stays as-is. */
export const translateDomainText = (text: string, i18n?: I18n): string => {
  const exact = exactTranslation(text);
  if (exact) return translateDomainMessage(i18n, exact);
  return translateStatusPattern(text, i18n) ?? translateAppPattern(text, i18n) ??
    translateRefusalPattern(text, i18n) ?? text;
};

/** English bandit texts (site names, enclosures, scaffold, tiers) → descriptor. */
const BANDIT_SITE_NAMES = new Map<string, MessageDescriptor>([
  ...banditEntries().flatMap(entry => [entry.text.name, ...Object.values(entry.text.variants ?? {})]
    .map(text => [text.en, contentDescriptor(text)] as const)),
  ...Object.values(DOMAIN_MESSAGES.names.bandit).map(descriptor => [descriptor.message!, descriptor] as const)
]);

const displayBanditSiteNameText = (name: string, i18n?: I18n) => {
  const descriptor = BANDIT_SITE_NAMES.get(name);
  return descriptor ? translateDomainMessage(i18n, descriptor) : name;
};

interface TroopNameOrigin { nation: string; plural: boolean; type: MilitaryTroopType }
/** English troop names → nation, number and type; for shared names the alphabetically last nation/type wins. */
const TROOP_ENGLISH_NAMES = new Map<string, TroopNameOrigin>();
const alphabetical = (first: string, second: string) => first.localeCompare(second);
const troopNameOrigins = (entry: SoldierEntry) => Object.entries(entry.text.variants ?? {}).map(([variant, text]) => {
  const [nation, form] = variant.split(".") as [string, string];
  return { nation, origin: { nation, plural: form === "plural", type: entry.key as MilitaryTroopType }, text };
});
const troopNames = soldierEntries().flatMap(troopNameOrigins);
for (const nation of [...new Set(troopNames.map(name => name.nation))].sort(alphabetical))
  for (const name of troopNames.filter(item => item.nation === nation)
    .sort((first, second) => alphabetical(first.origin.type, second.origin.type)))
    TROOP_ENGLISH_NAMES.set(name.text.en, name.origin);

const displayTroopNameText = (name: string, i18n?: I18n) => {
  const entry = TROOP_ENGLISH_NAMES.get(name);
  return entry ? displayTroopName(entry.nation, entry.type, entry.plural, i18n) : name;
};

/** Tutorial chapter title by chapter number. */
export const displayTutorialChapter = (chapter: number, i18n?: I18n) => {
  const descriptor = TUTORIAL.chapter[chapter as keyof typeof TUTORIAL.chapter];
  return descriptor ? translateDomainMessage(i18n, descriptor) : "";
};

export interface TutorialCopy {
  benefit: string;
  tips: string;
  why: string;
}

/** The default benefit and tips of an objective kind; other kinds read like an action (`event`). */
const TUTORIAL_DEFAULT_COPY: Readonly<Record<string, Record<"benefit" | "tips", MessageDescriptor>>> = {
  build: { benefit: TUTORIAL.defaults.buildBenefit, tips: TUTORIAL.defaults.eventTips },
  deliver: { benefit: TUTORIAL.defaults.deliverBenefit, tips: TUTORIAL.defaults.deliverTips },
  event: { benefit: TUTORIAL.defaults.eventBenefit, tips: TUTORIAL.defaults.eventTips },
  produce: { benefit: TUTORIAL.defaults.produceBenefit, tips: TUTORIAL.defaults.produceTips }
};

/** The message of each description of a tutorial step: its own copy, else the shared default of its objective. */
export const tutorialQuestCopyMessages = (
  quest: { id: string; objective: { kind: string } }
): Record<keyof TutorialCopy, MessageDescriptor> => {
  const stepCopy = TUTORIAL.quests[quest.id as keyof typeof TUTORIAL.quests] as
    { benefit?: MessageDescriptor; tips?: MessageDescriptor; why?: MessageDescriptor } | undefined;
  const defaults = TUTORIAL_DEFAULT_COPY[quest.objective.kind] ?? TUTORIAL_DEFAULT_COPY.event!;
  const defaultWhy = quest.id.startsWith("supply.reserve-") ? TUTORIAL.supplyWhy : TUTORIAL.defaults.eventBenefit;
  return {
    benefit: stepCopy?.benefit ?? defaults.benefit,
    tips: stepCopy?.tips ?? defaults.tips,
    why: stepCopy?.why ?? defaultWhy
  };
};

/** A tutorial step's descriptions, using shared defaults where the step stored the default text. */
export const tutorialQuestCopy = (
  quest: { id: string; objective: { kind: string } },
  i18n?: I18n
): TutorialCopy => {
  const messages = tutorialQuestCopyMessages(quest);
  return {
    benefit: translateDomainMessage(i18n, messages.benefit),
    tips: translateDomainMessage(i18n, messages.tips),
    why: translateDomainMessage(i18n, messages.why)
  };
};
