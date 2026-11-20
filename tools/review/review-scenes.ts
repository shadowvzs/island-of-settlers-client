import type { Browser, Page } from "playwright-core";

import { ROAD_DECORATION_ITEM_DEFINITIONS,
  type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { type LiveWindow, openDecorReviewPage, type Point,
  stageRoadDecorations } from "../bench/decor-review-session";
import { type FlatIslandBuilding, type FlatIslandPlot, openFixturePage,
  writeFlatIslandGame } from "../bench/flat-island-fixture";
import { type BuildingSubject, type ReviewPreset, type ReviewSpec, type ReviewSubject,
  sceneKey } from "./review-spec";

/** Where a subject stands and how the views approach it. */
export interface ReviewSite extends Point {
  /** Possessed stands lie on the far side of the subject from this point. */
  from: Point;
  lift: number;
  /** Spyglass stand distance (cells): it magnifies at least 3x, so the whole subject must fit its circle. */
  spyglassDistance: number;
  /** Possessed close stand distance from the subject centre (cells). */
  standDistance: number;
}

export interface ReviewScene {
  key: string;
  subjects: number[];
}

export interface StagedScene {
  page: Page;
  sites: Map<number, ReviewSite>;
}

const FIXTURE_CELLS = 96;
/** Building plots around the fixture HQ (island centre 48.5): a row south, then a row north of it. */
const BUILDING_SLOTS: readonly Point[] = [30, 68].flatMap(z => [24, 40, 56, 72].map(x => ({ x, z })));

/** Subjects grouped by the scene they are staged in, in first-appearance order. */
export const groupScenes = (spec: ReviewSpec): ReviewScene[] => {
  const scenes = new Map<string, number[]>();
  spec.subjects.forEach((subject, index) => {
    const key = sceneKey(subject, spec);
    scenes.set(key, [...scenes.get(key) ?? [], index]);
  });
  return [...scenes].map(([key, subjects]) => ({ key, subjects }));
};

const sceneQuery = (spec: ReviewSpec, base: string) => {
  const weather = spec.weather === "clear" ? "" : `&${spec.weather}=1`;
  return `${base}${base ? "&" : ""}time=${encodeURIComponent(spec.time)}${weather}`;
};

const headquarters = (page: Page) => page.evaluate(() => {
  const { x, z } = (window as LiveWindow).__settlement.simulation.headquarters;
  return { x, z } as Point;
});

const liftOf = (spec: ReviewSpec, subject: ReviewSubject) => spec.lift ?? (subject.kind === "building" ? 1.5 : 0);

const buildingOrder = (subject: BuildingSubject, slot: number): FlatIslandBuilding => {
  const at = BUILDING_SLOTS[slot];
  if (!at) throw new Error(`At most ${BUILDING_SLOTS.length} buildings per nation in one spec`);
  return { level: subject.level, rotation: subject.rotation ?? 0, typeId: subject.typeId, ...at };
};

/** The building's centre; stands lie on its door side (the access point mirrored through the centre). */
const buildingSite = (plot: FlatIslandPlot, lift: number): ReviewSite => ({
  from: { x: 2 * plot.x - plot.access.x, z: 2 * plot.z - plot.access.z }, lift, spyglassDistance: 22,
  standDistance: Math.max(...plot.footprint) / 2 + 3, x: plot.x, z: plot.z
});

const stageBuildings = async (browser: Browser, url: string, spec: ReviewSpec, scene: ReviewScene,
  preset: ReviewPreset, errors: string[]): Promise<StagedScene> => {
  const subjects = scene.subjects.map(index => spec.subjects[index] as BuildingSubject);
  let plots: FlatIslandPlot[] = [];
  const prepare = async (page: Page) => {
    await openFixturePage(page, url);
    plots = await writeFlatIslandGame(page, { buildings: subjects.map(buildingOrder), cells: FIXTURE_CELLS,
      name: `Review sheet ${spec.name}`, grassGround: true,
      nation: subjects[0]!.nation, stockAll: 400 });
  };
  const page = await openDecorReviewPage(browser, url, preset, errors, sceneQuery(spec, "reveal=1"), prepare);
  const sites = new Map(scene.subjects.map((index, slot) =>
    [index, buildingSite(plots[slot]!, liftOf(spec, spec.subjects[index]!))]));
  return { page, sites };
};

const decorationOrder = (item: string) => {
  const id = `roadDecoration:${item}:native` as RoadDecorationItemId;
  const definition = ROAD_DECORATION_ITEM_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown decoration ${id}`);
  return { id, offerId: definition.offerId };
};

/** Takes the placed frame of a decoration subject (each frame once), or a position subject's point. */
const islandSubjectPoint = (subject: ReviewSubject, placed: { item: string; x: number; z: number }[]) => {
  if (subject.kind === "position") return subject;
  if (subject.kind !== "decoration") return undefined;
  const at = placed.findIndex(entry => entry.item === decorationOrder(subject.item).id);
  return at < 0 ? undefined : placed.splice(at, 1)[0];
};

/** Decorations are bought and placed beside the HQ roads; positions are taken as given. */
const stageIsland = async (browser: Browser, url: string, spec: ReviewSpec, scene: ReviewScene,
  preset: ReviewPreset, errors: string[]): Promise<StagedScene> => {
  const first = spec.subjects[scene.subjects[0]!]!;
  const base = first.kind === "position" && first.query ? first.query : spec.query;
  const page = await openDecorReviewPage(browser, url, preset, errors, sceneQuery(spec, base));
  const hq = await headquarters(page);
  const decorations = scene.subjects.filter(index => spec.subjects[index]!.kind === "decoration");
  const items = decorations.map(index => (spec.subjects[index] as { item: string }).item);
  const placed = items.length ? (await stageRoadDecorations(page, items.map(decorationOrder), 3.2)).placed : [];
  const sites = new Map<number, ReviewSite>();
  for (const index of scene.subjects) {
    const subject = spec.subjects[index]!;
    const site = islandSubjectPoint(subject, placed);
    if (!site) throw new Error(`Subject ${index} could not be staged`);
    const standDistance = subject.kind === "position" ? subject.stand ?? 4 : 4;
    sites.set(index, { from: hq, lift: liftOf(spec, subject), spyglassDistance: 10, standDistance, x: site.x,
      z: site.z });
  }
  return { page, sites };
};

/** Opens the scene's page in `preset` and stages its subjects. */
export const stageScene = (browser: Browser, url: string, spec: ReviewSpec, scene: ReviewScene,
  preset: ReviewPreset, errors: string[]) => {
  const stage = scene.key.startsWith("building:") ? stageBuildings : stageIsland;
  return stage(browser, url, spec, scene, preset, errors);
};
