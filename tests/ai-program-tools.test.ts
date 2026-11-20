import { type BuildProgram, buildProgramCatalog, type CatalogSource, validateBuildPrograms } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { unlistedBuildings } from "../tools/ai/program-catalog";
import { buildProgramReport } from "../tools/ai/program-report";
import {
  DEFAULT_GOAL_WEIGHT, DEFAULT_TARGET_COUNT, DEFAULT_TARGET_FROM_BUILDINGS, suggestionSummary, suggestProgramGoals
} from "../tools/ai/program-suggest";

interface FakeBuilding {
  construction?: Record<string, number>;
  nations?: readonly string[];
  retired?: boolean;
  rules: Record<string, unknown>;
}

const production = (inputs: string[], outputs: string[]) => ({ production: { inputs, outputs } });

/** A two-nation catalog: a wood chain, a residence, a leather chain nobody lists and a few non-candidates. */
const BUILDINGS: Record<string, FakeBuilding> = {
  bakery: { rules: production(["flour"], ["bread"]) },
  barracks: { rules: { military: { garrison: 3 }, ...production(["coins"], []) } },
  lookout: { rules: { production: { inputs: [], outputs: [], service: true } } },
  oldMill: { retired: true, rules: production([], ["flour"]) },
  sawmill: { construction: { planks: 1 }, rules: production(["logs"], ["planks"]) },
  skinner: { construction: { planks: 1 }, rules: production([], ["hides"]) },
  smallResidence: { construction: { planks: 2 }, rules: { residence: { limit: 10 } } },
  smithy: { rules: production(["iron"], ["sword"]) },
  tannery: { construction: { planks: 2 }, nations: ["roman"], rules: production(["hides", "planks"], ["leather"]) },
  woodcutter: { rules: production([], ["logs"]) }
};

const files: CatalogSource["files"] = [
  { entries: [{ key: "roman" }, { key: "viking" }], file: "nations.json", kind: "nation" },
  {
    entries: Object.entries(BUILDINGS).map(([key, { nations, retired }]) => ({
      building: { placeable: true }, category: "building.test", id: `building:${key}`, key, retired,
      text: { name: { en: `The ${key}` } }, variants: { nation: nations ?? "all" }
    })),
    file: "buildings.json",
    kind: "building"
  }
];

const readSidecar = (path: string): unknown => {
  const [, key, name] = path.split("/");
  const building = BUILDINGS[key!];
  if (!building) return undefined;
  return name === "rules.json" ? building.rules : { cost: building.construction ?? {} };
};

const goal = (id: string, group: string, requires: string[] = []) => ({
  building: `building:${id}`, group, id, requires: requires.map(required => ({ count: 1, goal: required })),
  target: [{ buildings: 0, count: 1 }], weight: 5
});
const group = { exposed: false, postures: { fortify: 100, grow: 100 }, style: 100 };
const programOf = (...extraGoals: ReturnType<typeof goal>[]) => ({
  commitmentPercent: 10,
  costWeight: 1,
  goals: [
    goal("woodcutter", "wood"), goal("sawmill", "wood", ["woodcutter"]), goal("smallResidence", "housing", ["sawmill"]),
    ...extraGoals
  ],
  groups: { housing: group, wood: group },
  stock: { default: { fortify: 20, grow: 20 }, resumeMargin: 5, wares: { planks: { fortify: 30, grow: 40 } } },
  style: "balanced",
  threatPenalty: 0
});

const catalog = buildProgramCatalog(files, readSidecar);
const issuesOf = (program: unknown) => validateBuildPrograms(files, readSidecar, { balanced: program });
const BROKEN = programOf(goal("castle", "wood"), goal("bakery", "wood"));

describe("build program issues", () => {
  it("names the program, kind and subject of a missing building and a broken chain", () => {
    const issues = issuesOf(BROKEN);
    expect(issues.every(issue => issue.style === "balanced")).toBe(true);
    expect(issues.find(issue => issue.kind === "unknownBuilding")).toMatchObject({
      building: "building:castle", goal: "castle", message: "Unknown building building:castle"
    });
    expect(issues.filter(issue => issue.kind === "missingProducer")).toMatchObject([
      { goal: "bakery", nation: "roman", neededBy: ["bakery"], ware: "flour" },
      { goal: "bakery", nation: "viking", neededBy: ["bakery"], ware: "flour" }
    ]);
    const unplaceable = issues.filter(issue => issue.kind === "notPlaceable");
    expect(unplaceable.map(issue => issue.nation)).toEqual(["roman", "viking"]);
  });

  it("lists every goal that needs an unproduced ware and marks malformed files", () => {
    const withoutSawmill = programOf();
    withoutSawmill.goals = withoutSawmill.goals.filter(entry => entry.id !== "sawmill")
      .map(entry => ({ ...entry, requires: [] }));
    expect(issuesOf(withoutSawmill)[0]).toMatchObject({ kind: "missingProducer", neededBy: ["smallResidence"] });
    expect(issuesOf({ ...programOf(), extra: 1 }).map(issue => issue.kind)).toEqual(["shape"]);
    expect(issuesOf(programOf())).toEqual([]);
  });
});

describe("stock target issues (EAI3c)", () => {
  it("reports a target at the resume margin and a target of a ware no goal produces", () => {
    const wares = { planks: { fortify: 5, grow: 40 }, gold: { fortify: 9, grow: 9 } };
    const program = { ...programOf(), stock: { ...programOf().stock, wares } };
    const issues = issuesOf(program);
    expect(issues).toMatchObject([{ kind: "stockMargin", ware: "planks" }, { kind: "stockWare", ware: "gold" }]);
    const { errors, lines } = buildProgramReport(catalog, { balanced: program }, issues);
    expect(errors).toBe(2);
    expect(lines).toContain("    error  stock target \"gold\": no goal produces it");
  });
});

describe("ai:check report", () => {
  it("groups errors per program and nation and reports an unknown building once", () => {
    const programs = { balanced: BROKEN };
    const { errors, lines } = buildProgramReport(catalog, programs, issuesOf(BROKEN));
    expect(errors).toBe(3);
    expect(lines).toContain(
      "    error  goal \"castle\": building \"building:castle\" no longer exists (removed or retired)");
    const roman = lines.indexOf("  Roman"), viking = lines.indexOf("  Viking");
    expect(roman).toBeGreaterThan(lines.indexOf("  Program"));
    expect(lines[roman + 1]).toBe("    error  no chain produces \"flour\" (needed by: bakery)");
    expect(viking).toBe(roman + 2);
    expect(lines.at(-1)).toBe("FAILED: 3 errors");
  });

  it("treats unlisted production and residence buildings as information", () => {
    const program = programOf();
    const { errors, lines } = buildProgramReport(catalog, { balanced: program }, issuesOf(program));
    expect(errors).toBe(0);
    expect(lines).toContain("    info   building \"tannery\" (The tannery) is not in this program");
    expect(lines.at(-1)).toBe("OK");
    expect(unlistedBuildings(catalog, program as unknown as BuildProgram).map(building => building.key))
      .toEqual(["bakery", "skinner", "smithy", "tannery"]);
  });
});

describe("ai:suggest drafts", () => {
  const draft = suggestProgramGoals(catalog, programOf() as unknown as BuildProgram);
  const suggestionOf = (id: string) => draft.suggestions.find(suggestion => suggestion.goal.id === id)!;

  it("drafts unlisted buildings in build order with the documented defaults", () => {
    expect(draft.suggestions.map(suggestion => suggestion.goal.id)).toEqual(["bakery", "skinner", "smithy", "tannery"]);
    expect(suggestionOf("skinner").goal).toEqual({
      building: "building:skinner", group: "wood", id: "skinner", requires: [{ count: 1, goal: "sawmill" }],
      target: [{ buildings: 0, count: 0 }, { buildings: DEFAULT_TARGET_FROM_BUILDINGS, count: DEFAULT_TARGET_COUNT }],
      weight: DEFAULT_GOAL_WEIGHT
    });
    expect(JSON.stringify(suggestProgramGoals(catalog, programOf() as unknown as BuildProgram)))
      .toBe(JSON.stringify(draft));
  });

  it("derives prerequisites from listed and draft producers and notes nation availability", () => {
    const { goal: tannery, notes } = suggestionOf("tannery");
    expect(tannery.nations).toEqual(["roman"]);
    expect(tannery.requires).toEqual([{ count: 1, goal: "sawmill" }, { count: 1, goal: "skinner" }]);
    expect(notes.nations).toMatchObject({ available: ["roman"], unavailable: ["viking"] });
    expect(notes.prerequisites).toMatchObject([
      { draftProducers: ["skinner"], requires: "skinner", status: "draft", wares: ["hides"] },
      { listedProducers: ["sawmill"], requires: "sawmill", status: "listed", uses: ["construction", "input"] }
    ]);
    expect(notes.warnings).toEqual(["hides from draft goals only: move skinner too"]);
  });

  it("flags a broken chain and summarises the draft", () => {
    expect(suggestionOf("smithy").notes.prerequisites).toMatchObject([{ status: "unproduced", wares: ["iron"] }]);
    expect(suggestionOf("bakery").notes.warnings)
      .toEqual(["no catalog building produces flour: start stock or trade only"]);
    expect(suggestionSummary(draft)[0]).toBe("balanced: 4 draft goals, 3 with warnings");
  });
});
