import {
  type BuildGoal, type BuildProgram, type BuildProgramCatalog, constructionWares, goalPlaysFor, productionWares
} from "@shared/catalog";

import { producesFor, type ProgramBuilding, programBuildingOf, unlistedBuildings } from "./program-catalog.ts";

/**
 * Draft goals for the production and residence buildings a build program does not list (`npm run ai:suggest`).
 * Pure and deterministic: the same catalog and program give the same draft. A draft is a starting point for the
 * review, never balance: the reviewer adjusts weight, target and group before moving an entry into the program.
 */

/** A draft's weight: the lowest of the balanced program, so an unreviewed goal never outranks a reviewed one. */
export const DEFAULT_GOAL_WEIGHT = 4;
/** How many of the building a draft wants. */
export const DEFAULT_TARGET_COUNT = 1;
/** Own buildings (sites included) before a draft wants its first building: the base economy stands by then. */
export const DEFAULT_TARGET_FROM_BUILDINGS = 20;
/** Finished buildings of each prerequisite goal a draft waits for. */
export const DEFAULT_REQUIREMENT_COUNT = 1;

type WareUse = "construction" | "input";
/**
 * `listed`: goals of the program cover every nation. `draft`: only together with other drafts (move those first).
 * `nationLimited`: some nation has no producer (widen a goal's `nations` or add a chain). `unproduced`: nothing in
 * the catalog produces the ware (start stock or trade only).
 */
type PrerequisiteStatus = "draft" | "listed" | "nationLimited" | "unproduced";

export interface SuggestedPrerequisite {
  /** Other draft goals that produce the ware. */
  draftProducers: readonly string[];
  /** Goals of the program that produce the ware. */
  listedProducers: readonly string[];
  /** The nations whose recipe or construction receipt needs the ware; `all`: every nation that places the draft. */
  nations: readonly string[] | "all";
  /** The nations that need it and have no producer, listed or draft. */
  nationsWithoutProducer: readonly string[];
  /** The goal the draft's `requires` names for it; absent when no single goal serves every nation of the draft. */
  requires?: string;
  status: PrerequisiteStatus;
  uses: readonly WareUse[];
  /** One ware, or the alternatives of which one is enough (miners' food). */
  wares: readonly string[];
}

export interface GoalSuggestion {
  /** Ready to move into the program's `goals` after the review. */
  goal: BuildGoal;
  notes: {
    building: string;
    /** Why the group was chosen. */
    group: string;
    nations: {
      available: readonly string[];
      /** Nations with their own recipe for the building. */
      recipes: Readonly<Record<string, { inputs: readonly string[]; outputs: readonly string[] }>>;
      unavailable: readonly string[];
    };
    /** The shared recipe's outputs. */
    outputs: readonly string[];
    prerequisites: readonly SuggestedPrerequisite[];
    warnings: readonly string[];
  };
}

export interface ProgramSuggestions {
  defaults: { requirementCount: number; targetCount: number; targetFromBuildings: number; weight: number };
  generatedBy: string;
  program: string;
  suggestions: readonly GoalSuggestion[];
}

/** A building that may produce a prerequisite: a goal of the program or another draft. */
interface Producer {
  building: ProgramBuilding;
  group?: string;
  id: string;
  listed: boolean;
  /** The nations that play it. */
  nations: readonly string[];
}

interface Need {
  nations: string[];
  uses: Set<WareUse>;
  wares: readonly string[];
}

const byText = (first: string, second: string) => first.localeCompare(second, "en");

const listedProducers = (catalog: BuildProgramCatalog, program: BuildProgram): Producer[] =>
  program.goals.flatMap(goal => {
    const building = programBuildingOf(catalog, goal.building);
    if (!building) return [];
    const nations = building.nations.filter(nation => goalPlaysFor(goal, nation));
    return [{ building, group: goal.group, id: goal.id, listed: true, nations }];
  });

const draftProducer = (building: ProgramBuilding): Producer =>
  ({ building, id: building.key, listed: false, nations: building.nations });

/** What the nation needs for the building: each input (miners: any one food) and each construction ware. */
const nationNeeds = (catalog: BuildProgramCatalog, building: ProgramBuilding, nation: string) => {
  const inputs = [...new Set(productionWares(building.rules, nation, "inputs"))];
  const anyOneFeeds = building.rules.production?.alternativeFood === true && inputs.length > 0;
  const alternatives = anyOneFeeds ? [inputs] : inputs.map(ware => [ware]);
  return [
    ...alternatives.map(wares => ({ use: "input" as const, wares })),
    ...constructionWares(catalog, building.id, nation).map(ware => ({ use: "construction" as const, wares: [ware] }))
  ];
};

const collectNeeds = (catalog: BuildProgramCatalog, building: ProgramBuilding): Need[] => {
  const needs = new Map<string, Need>();
  for (const nation of building.nations) for (const { use, wares } of nationNeeds(catalog, building, nation)) {
    const key = wares.join("+");
    const need = needs.get(key) ?? { nations: [], uses: new Set<WareUse>(), wares };
    if (!need.nations.includes(nation)) need.nations.push(nation);
    need.uses.add(use);
    needs.set(key, need);
  }
  return [...needs.keys()].sort(byText).map(key => needs.get(key)!);
};

const servesNation = (producer: Producer, need: Need, nation: string) =>
  producer.nations.includes(nation) && need.wares.some(ware => producesFor(producer.building, nation, ware));

const needStatus = (need: Need, listed: readonly Producer[], drafts: readonly Producer[]): PrerequisiteStatus => {
  const covers = (producers: readonly Producer[]) =>
    need.nations.every(nation => producers.some(producer => servesNation(producer, need, nation)));
  if (covers(listed)) return "listed";
  if (covers([...listed, ...drafts])) return "draft";
  return listed.length + drafts.length ? "nationLimited" : "unproduced";
};

/** The prerequisite for one need of the draft building, with the single goal (if any) its `requires` can name. */
const resolveNeed = (need: Need, draft: Producer, producers: readonly Producer[]): SuggestedPrerequisite => {
  const serving = producers.filter(producer => producer.id !== draft.id
    && need.nations.some(nation => servesNation(producer, need, nation)));
  const listed = serving.filter(producer => producer.listed), drafts = serving.filter(producer => !producer.listed);
  const status = needStatus(need, listed, drafts);
  /** A requirement must be a goal every nation of the draft plays, and it should serve every nation in need. */
  const forEveryNation = (candidates: readonly Producer[]) => candidates.find(producer =>
    draft.nations.every(nation => producer.nations.includes(nation))
    && need.nations.every(nation => servesNation(producer, need, nation)));
  const required = status === "listed" ? forEveryNation(listed) : forEveryNation(drafts);
  const isServed = (nation: string) => serving.some(producer => servesNation(producer, need, nation));
  return {
    draftProducers: drafts.map(producer => producer.id),
    listedProducers: listed.map(producer => producer.id),
    nations: need.nations.length === draft.nations.length ? "all" : need.nations,
    nationsWithoutProducer: need.nations.filter(nation => !isServed(nation)),
    ...(required ? { requires: required.id } : {}),
    status,
    uses: [...need.uses].sort(byText),
    wares: need.wares
  };
};

const mostUsed = (groups: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
  const byCountThenName = (first: string, second: string) =>
    counts.get(second)! - counts.get(first)! || byText(first, second);
  return [...counts.keys()].sort(byCountThenName)[0];
};

/** The group of the program's goals of the same kind, else of the first prerequisite goal, else the first group. */
const suggestGroup = (
  program: BuildProgram, building: ProgramBuilding, listed: readonly Producer[], requires: readonly string[]
) => {
  const isResidence = building.rules.residence !== undefined;
  const peers = listed.filter(producer => isResidence ? producer.building.rules.residence !== undefined
    : producer.building.category === building.category);
  const peerGroup = mostUsed(peers.map(producer => producer.group!));
  const peerKind = isResidence ? "residences" : `${building.category} goals`;
  if (peerGroup) return { group: peerGroup, reason: `listed ${peerKind}` };
  const prerequisite = listed.find(producer => requires.includes(producer.id));
  if (prerequisite) return { group: prerequisite.group!, reason: `its prerequisite goal ${prerequisite.id}` };
  const fallback = Object.keys(program.groups).sort(byText)[0] ?? "";
  return { group: fallback, reason: "guessed (no similar goal): choose a group or add one" };
};

const nationRecipes = (building: ProgramBuilding) => Object.fromEntries(building.nations
  .filter(nation => building.rules.nations?.[nation]?.production)
  .map(nation => [nation, {
    inputs: productionWares(building.rules, nation, "inputs"),
    outputs: productionWares(building.rules, nation, "outputs")
  }]));

/** One warning per set of draft producers, so the nation variants of one chain (the drinks) read as one line. */
const draftWarnings = (prerequisites: readonly SuggestedPrerequisite[]) => {
  const waresByProducers = new Map<string, string[]>();
  for (const need of prerequisites.filter(prerequisite => prerequisite.status === "draft")) {
    const producers = need.draftProducers.join(" or ");
    waresByProducers.set(producers, [...waresByProducers.get(producers) ?? [], ...need.wares]);
  }
  return [...waresByProducers].map(([producers, wares]) =>
    `${wares.join(", ")} from draft goals only: move ${producers} too`);
};

const prerequisiteWarnings = (prerequisites: readonly SuggestedPrerequisite[]) => [
  ...prerequisites.flatMap(need => {
    const wares = need.wares.join(" or ");
    if (need.status === "unproduced") return [`no catalog building produces ${wares}: start stock or trade only`];
    if (need.status !== "nationLimited") return [];
    return [`no producer of ${wares} for ${need.nationsWithoutProducer.join(", ")}: widen a goal's nations`];
  }),
  ...draftWarnings(prerequisites)
];

const suggestGoal = (
  catalog: BuildProgramCatalog, program: BuildProgram, building: ProgramBuilding, producers: readonly Producer[]
): GoalSuggestion => {
  const draft = draftProducer(building);
  const prerequisites = collectNeeds(catalog, building).map(need => resolveNeed(need, draft, producers));
  const order = producers.map(producer => producer.id);
  const requires = [...new Set(prerequisites.flatMap(need => need.requires ?? []))]
    .sort((first, second) => order.indexOf(first) - order.indexOf(second));
  const { group, reason } = suggestGroup(program, building, producers.filter(producer => producer.listed), requires);
  const unavailable = catalog.nations.filter(nation => !building.nations.includes(nation));
  return {
    goal: {
      building: building.id as BuildGoal["building"],
      group,
      id: building.key,
      ...(unavailable.length ? { nations: building.nations } : {}),
      ...(requires.length ? { requires: requires.map(goal => ({ count: DEFAULT_REQUIREMENT_COUNT, goal })) } : {}),
      target: [
        { buildings: 0, count: 0 }, { buildings: DEFAULT_TARGET_FROM_BUILDINGS, count: DEFAULT_TARGET_COUNT }
      ],
      weight: DEFAULT_GOAL_WEIGHT
    },
    notes: {
      building: building.name,
      group: reason,
      nations: { available: building.nations, recipes: nationRecipes(building), unavailable },
      outputs: building.rules.production?.outputs ?? [],
      prerequisites,
      warnings: prerequisiteWarnings(prerequisites)
    }
  };
};

/** A draft whose requirements cannot all stand earlier (a cycle): drops the later ones and says so. */
const withoutLaterRequirements = (suggestion: GoalSuggestion, placed: ReadonlySet<string>): GoalSuggestion => {
  const { requires = [], ...goal } = suggestion.goal;
  const earlier = requires.filter(required => placed.has(required.goal));
  const later = requires.filter(required => !placed.has(required.goal)).map(required => required.goal);
  return {
    goal: { ...goal, ...(earlier.length ? { requires: earlier } : {}) },
    notes: {
      ...suggestion.notes,
      warnings: [...suggestion.notes.warnings, `requirement cycle: ${later.join(", ")} dropped from requires`]
    }
  };
};

/** Build order: a draft follows the drafts it requires; otherwise by key a-z. */
const orderSuggestions = (suggestions: readonly GoalSuggestion[], listedGoals: readonly string[]) => {
  const pending = [...suggestions], placed = new Set(listedGoals), ordered: GoalSuggestion[] = [];
  while (pending.length) {
    const ready = pending.findIndex(({ goal }) => (goal.requires ?? []).every(required => placed.has(required.goal)));
    const [next] = pending.splice(Math.max(ready, 0), 1);
    const suggestion = ready < 0 ? withoutLaterRequirements(next!, placed) : next!;
    ordered.push(suggestion);
    placed.add(suggestion.goal.id);
  }
  return ordered;
};

export const suggestProgramGoals = (catalog: BuildProgramCatalog, program: BuildProgram): ProgramSuggestions => {
  const unlisted = unlistedBuildings(catalog, program);
  const producers = [...listedProducers(catalog, program), ...unlisted.map(draftProducer)];
  const suggestions = unlisted.map(building => suggestGoal(catalog, program, building, producers));
  return {
    defaults: {
      requirementCount: DEFAULT_REQUIREMENT_COUNT,
      targetCount: DEFAULT_TARGET_COUNT,
      targetFromBuildings: DEFAULT_TARGET_FROM_BUILDINGS,
      weight: DEFAULT_GOAL_WEIGHT
    },
    generatedBy: "npm run ai:suggest (draft: review, adjust, move entries into the program, run npm run ai:check)",
    program: program.style,
    suggestions: orderSuggestions(suggestions, program.goals.map(goal => goal.id))
  };
};

const summaryLine = ({ goal, notes }: GoalSuggestion) => {
  const requires = (goal.requires ?? []).map(required => required.goal).join(", ") || "nothing";
  const warnings = notes.warnings.map(warning => `\n      ! ${warning}`).join("");
  return `  ${goal.id} (${notes.building}): group ${goal.group}, requires ${requires}${warnings}`;
};

/** The short console summary of one program's draft. */
export const suggestionSummary = ({ program, suggestions }: ProgramSuggestions): string[] => {
  if (!suggestions.length) return [`${program}: every production and residence building is listed`];
  const flagged = suggestions.filter(suggestion => suggestion.notes.warnings.length).length;
  return [
    `${program}: ${suggestions.length} draft goals, ${flagged} with warnings`, ...suggestions.map(summaryLine)
  ];
};
