import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { type SeasonPhase } from "../../../island-of-settlers-shared/src/appearance/season-calendar";
import { resolveSeasonWeights, type SeasonWeights } from "../../src/render-common/seasonal-appearance/season-weights";
import { PROP } from "../../src/shared/world/world-data";
import { launchBrowser, startDevServer } from "../bench/browser";
import { type FlatIslandBuilding, type FlatIslandProp, openFixturePage,
  writeFlatIslandGame } from "../bench/flat-island-fixture";
import { openFrozenPage, pinScene } from "../bench/frozen-frame-review";
import { CAPTURES, HIDE_UI, PARITY_VIEWPORT, settleFrame } from "../bench/parity-helpers";
import { type MaskedDiffStats, writeMaskedDiff } from "./season-masked-diff";

/**
 * Seasons town proof (plan 11.2: autumn/dormant/spring never change a building). Per nation a flat fixture
 * town (vineyard, winery, forester, farm, flax farm, residences, brewery: the buildings with their own plants,
 * planters, vines and crops) ringed by broadleaf/evergreen trees and bushes. The page loads with
 * `?season=autumn` (proves the live season reaches the frozen frame), then every look is drawn from the
 * same frozen frame with the season weights swapped, with and without buildings. A masked diff per look
 * counts building pixels that changed (must be 0; see season-masked-diff.ts).
 *
 *   <captures>/browser-slot.sh npx tsx --env-file=<env> tools/review/season-town-proof.ts
 * Env: OUTPUT_DIR, SEASON_NATIONS=roman,viking,nubian,japanese,chinese,persian, SEASON_PRESETS=high,minimal,
 * SEASON_LOOKS=autumn,mid,dormant,budding,spring,monsoon (summer is always the reference), SEASON_SETTLE_MS.
 */
const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "seasons-2", "town-proof"));
const NATIONS = (process.env.SEASON_NATIONS ?? "roman,viking,nubian,japanese,chinese,persian").split(",");
const PRESETS = (process.env.SEASON_PRESETS ?? "high,minimal").split(",");
const CELLS = 96;

const phase = (from: SeasonPhase["from"], to: SeasonPhase["to"], blend: number): SeasonPhase => ({ blend, from, to });
/** The looks as the island would resolve them from the global phase (temperate climate). */
const LOOK_PHASES: Readonly<Record<string, SeasonPhase>> = {
  autumn: phase("autumn", "autumn", 1),
  budding: phase("winter", "spring", 0.75),
  dormant: phase("autumn", "winter", 0.45),
  melt: phase("winter", "spring", 0.2),
  mid: phase("summer", "autumn", 0.5),
  monsoon: phase("monsoon", "monsoon", 1),
  "snow-mid": phase("autumn", "winter", 0.7),
  spring: phase("spring", "spring", 1),
  summer: phase("summer", "summer", 1),
  winter: phase("winter", "winter", 1)
};
/**
 * The page's own season. The snow looks (snow-mid, winter, melt) need the GPU season snow compiled: load with
 * SEASON_QUERY='&season=winter&seasonFrom=autumn&seasonBlend=0.05' (armed, snow ramp 0, dormant below the 0.3
 * bare-wood switch, so the tree draw ranges stay put between the passes), which also skips the autumn-live check.
 */
const PAGE_SEASON = process.env.SEASON_QUERY ?? "&season=autumn";
const LOOKS = ["summer", ...(process.env.SEASON_LOOKS ?? "autumn,mid,dormant,budding,spring").split(",")];

/** Buildings that carry their own plants (vines, crops, planters, saplings) plus residences. */
const TOWN_TYPES = [5, 6, 20, 37, 60, 58, 59, 23];
/** Two plot rows round the HQ (island centre 48.5); +x runs down-right and +z down-left on screen. */
const PLOT_SLOTS = [36, 61].flatMap(z => [28, 38, 48, 58].map(x => ({ x, z })));
const VIEWS = [
  { name: "south-close", x: 43, z: 36, zoom: 1 },
  { name: "north-close", x: 43, z: 62, zoom: 1 },
  { name: "town", x: 44, z: 49, zoom: 0.55 }
] as const;

const TREE_CYCLE = [PROP.broadleafTree, PROP.birchTree, PROP.walnutTree, PROP.coniferTree, PROP.hardwoodTree,
  PROP.broadleafTree, PROP.cedarTree, PROP.birchTree, PROP.mahoganyTree, PROP.walnutTree];
const BUSH_CYCLE = [PROP.bush, PROP.berryBush, PROP.broadleafShrub, PROP.fieldShrub, PROP.sapling,
  PROP.willowShrub];

/** Tree belts behind the south row and in front of the north row, bushes in the gaps between plots. */
const townProps = (): FlatIslandProp[] => {
  const trees = [26, 29.5, 68, 71.5].flatMap((z, row) => Array.from({ length: 16 }, (_, column) => ({
    type: TREE_CYCLE[(column + row * 3) % TREE_CYCLE.length]!, x: 18 + column * 3.2 + (row % 2) * 1.6, z
  })));
  const bushes = [36, 61].flatMap((z, row) => [33, 43, 53].flatMap((x, column) => [-1.2, 1.2].map(offset => ({
    type: BUSH_CYCLE[(column * 2 + row + (offset > 0 ? 1 : 0)) % BUSH_CYCLE.length]!, x: x + offset * 0.4,
    z: z + offset
  }))));
  return [...trees, ...bushes];
};

const buildingsOf = (types: number[]): FlatIslandBuilding[] =>
  types.map((typeId, slot) => ({ rotation: 0, typeId, ...PLOT_SLOTS[slot]! }));

/** Writes the fixture town; a building the nation cannot place is dropped (its error names the type). */
const createTownSave = async (browser: Browser, url: string, nation: string) => {
  const page = await browser.newPage();
  try {
    await openFixturePage(page, url);
    let types = [...TOWN_TYPES];
    for (;;) {
      try {
        await writeFlatIslandGame(page, { buildings: buildingsOf(types), cells: CELLS, grassGround: true,
          name: `Season town ${nation}`, nation, props: townProps(), stockAll: 400 });
        break;
      } catch (error) {
        const failed = Number(/building (\d+)/.exec((error as Error).message)?.[1]);
        if (!types.includes(failed)) throw error;
        console.warn(`${nation}: skip building ${failed}: ${(error as Error).message.slice(0, 160)}`);
        types = types.filter(type => type !== failed);
      }
    }
    const save = await page.evaluate(async () => {
      const store = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      return (await (await store.openLocalSaveStore()).readStartupGame()) as string;
    });
    return { save, types };
  } finally {
    await page.close();
  }
};

/**
 * Freezes the live frame (pinned daylight, no actors) and returns the live season weights it carries. The
 * page clock stops too: some building decor (the Nubian cloth wind) animates on performance.now().
 */
const freezeTown = (page: Page) => page.evaluate(() => {
  const debug = (globalThis as any).__atmosphereLiveDebug;
  debug.freeze();
  debug.stripDynamic(debug.frozenFrame);
  debug.townBuildings = debug.frozenFrame.buildings;
  debug.liveSeason = structuredClone(debug.frozenFrame.environment.season);
  const stoppedAt = performance.now();
  performance.now = () => stoppedAt;
  return debug.liveSeason ?? null;
});

const drawLook = async (page: Page, view: (typeof VIEWS)[number], weights: SeasonWeights | null,
  buildings: boolean, file: string) => {
  await page.evaluate(({ hasBuildings, season, target }) => {
    const debug = (globalThis as any).__atmosphereLiveDebug;
    const frame = debug.frozenFrame;
    frame.environment.season = season ?? debug.liveSeason;
    frame.buildings = hasBuildings ? debug.townBuildings : [];
    Object.assign(frame.camera, { centerX: target.x, centerZ: target.z, tilt: 0, yaw: 0, zoom: target.zoom });
    frame.time = 12;
    debug.draw();
  }, { hasBuildings: buildings, season: weights, target: view });
  await settleFrame(page);
  await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
    path: file });
};

interface ProofRow extends MaskedDiffStats { look: string; nation: string; preset: string; view: string }

const shotName = (nation: string, preset: string, view: string, look: string, buildings = true) =>
  join(OUT, `${nation}-${preset}-${view}-${look}${buildings ? "" : "-nobuild"}.png`);

/**
 * Every view x look with buildings, then every one without: the building layer rebuilds asynchronously after
 * the frame drops its buildings, so they are hidden once, last.
 */
const shootTown = async (page: Page, nation: string, preset: string) => {
  for (const buildings of [true, false]) {
    for (const view of VIEWS) {
      if (buildings && !process.env.SEASON_QUERY)
        await drawLook(page, view, null, true, shotName(nation, preset, view.name, "autumn-live"));
      for (const look of LOOKS) {
        const weights = resolveSeasonWeights(LOOK_PHASES[look]!, "temperate");
        await drawLook(page, view, weights, buildings, shotName(nation, preset, view.name, look, buildings));
      }
    }
  }
};

/** Each look against summer; the live autumn frame against the autumn weights (the live season path). */
const diffTown = async (browser: Browser, nation: string, preset: string) => {
  const rows: ProofRow[] = [];
  for (const view of VIEWS) {
    const liveCheck = LOOKS.includes("autumn") && !process.env.SEASON_QUERY ? ["autumn-live"] : [];
    for (const look of [...LOOKS.slice(1), ...liveCheck]) {
      const live = look === "autumn-live";
      const reference = live ? "autumn" : "summer";
      const name = (season: string, buildings = true) => shotName(nation, preset, view.name, season, buildings);
      const files = { after: name(look), afterBare: name(live ? "autumn" : look, false), before: name(reference),
        beforeBare: name(reference, false) };
      const stats = await writeMaskedDiff(browser, files, name(`diff-${look}`));
      rows.push({ look, nation, preset, view: view.name, ...stats });
    }
  }
  return rows;
};

/** One nation on one preset: the frozen town in every look, then the masked diffs. */
const proveTown = async (browser: Browser, url: string, nation: string, save: string, preset: string) => {
  const { errors, page } = await openFrozenPage(browser, url, { quality: preset,
    // The fixture save has no runtime block, so stageFrozenSave would break it; pinScene pins the light.
    query: `&renderer=webgl&hdr=off&reveal=1${PAGE_SEASON}`, stagedSave: save, viewport: PARITY_VIEWPORT });
  try {
    // SEASON_SETTLE_MS: let the deferred impostor warm-up finish first (an armed winter page bakes the sprites'
    // wind/kind map too, and trees switching to sprites between the passes would read as changed buildings).
    await page.waitForTimeout(Number(process.env.SEASON_SETTLE_MS ?? 1500));
    await pinScene(page, "day", true);
    const live = await freezeTown(page);
    await page.addStyleTag({ content: HIDE_UI });
    await shootTown(page, nation, preset);
    return { errors, live, rows: await diffTown(browser, nation, preset) };
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const report: Record<string, unknown>[] = [];
  try {
    for (const nation of NATIONS) {
      const { save, types } = await createTownSave(browser, url, nation);
      for (const preset of PRESETS) {
        const result = await proveTown(browser, url, nation, save, preset);
        report.push({ nation, preset, types, ...result });
        writeFileSync(join(OUT, "season-town-proof.json"), JSON.stringify(report, null, 2));
        const worst = Math.max(...result.rows.map(row => row.buildingChanged));
        console.log(`${nation} ${preset}: live ${JSON.stringify(result.live)}; worst building pixels ${worst}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
