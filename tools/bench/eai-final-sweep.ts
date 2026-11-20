import { DIFFICULTY_PROFILES } from "../../src/shared/balance/enemy-scaling";
import { adventureDefencePlan } from "../../src/shared/settlement/adventure-camp-defences";
import { adventureEnemyPlan } from "../../src/shared/settlement/adventure-rules";
import type { ColonyDifficulty } from "../../src/shared/settlement/colony-expedition-rules";
import { DIFFICULTY_LEVELS, type DifficultyLevel } from "../../src/shared/settlement/difficulty";
import type { FactionAiLevel } from "../../src/shared/world/scenario-faction-ai";
import {
  createDevelopReferenceIsland, DEVELOP_REFERENCE_MAPS, placeIdlePlayerSite, REFERENCE_AI
} from "../../tests/helpers/develop-reference-maps";
import { ATTACK_FIXTURE_FACTION, createFactionAttackFixture } from "../../tests/helpers/faction-attack-fixture";
import {
  type AssaultOutcome, simulateColonyAssault, summarize, typicalForce, withBalanceDifficulty
} from "./garrison-balance-harness";

/**
 * EAI-FINAL light sweep (owner rule 2026-11-16: catch broken extremes only, no tuning campaign). Sections:
 * `colonies` (the DEC-03 reference force per island level against every global difficulty, plus a force grown by the
 * difficulty's soldier factor: "send more troops"), `adventures` (the scaled enemy roster per level) and `develop`
 * (the economy AI on the three P3 reference maps per level: first strike or raid, soldiers at 30 / 60 min, buildings) and
 * `attacks` (the EAI4b attack fixture per level: first strike or raid, when the player's Guardhouse falls).
 * Run: `npx tsx tools/bench/eai-final-sweep.ts`; `CASES=colonies,adventures,develop`, `SEEDS=3`, `MINUTES=60`,
 * `ISLANDS=easy,medium,hard`, `GLOBALS=normal,hard,veryHard` (one process per case runs in parallel) and
 * `GROWTH=1,1.5` (the player force factors above Normal). The idle player of `develop` owns a woodcutter beside its
 * headquarters (the headquarters is never a target); `PLAYER=hq` leaves it the headquarters alone (EAI-CLOSE).
 */
const sections = new Set((process.env.CASES ?? "colonies,adventures,attacks,develop").split(","));
const seeds = Array.from({ length: Number(process.env.SEEDS ?? 3) }, (_, index) => index + 1);
const minutes = Number(process.env.MINUTES ?? 60);
const ISLAND_LEVELS = (process.env.ISLANDS ?? "easy,medium,hard").split(",") as ColonyDifficulty[];
/** Player forces per global difficulty: the reference force grown by these factors of its soldier factor. */
const FORCE_GROWTH = (process.env.GROWTH ?? "1,1.5").split(",").map(Number);
const idlePlayerSite = process.env.PLAYER !== "hq";
const GLOBAL_LEVELS = (process.env.GLOBALS ?? DIFFICULTY_LEVELS.join(",")).split(",") as DifficultyLevel[];
/** DEC-03 accepted reference forces (owner targets 2026-10-13: easy ~15, medium ~28, hard 40+ veterans). */
const REFERENCE_FORCES: Readonly<Record<ColonyDifficulty, { ranks: readonly number[]; size: number }>> = {
  easy: { ranks: [0, 1], size: 15 },
  hard: { ranks: [1, 2], size: 45 },
  medium: { ranks: [0, 1], size: 28 }
};
const TICKS_PER_SECOND = 20;
const SAMPLE_SECONDS = 10;

const row = (cells: readonly (string | number)[]) => console.log(`| ${cells.join(" | ")} |`);
const header = (cells: readonly string[]) => { row(cells); row(cells.map(() => "---")); };
const percent = (value: number) => `${Math.round(value * 100)} %`;
const meanOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const winTime = (seconds: number | null) => seconds === null ? "–" : `${Math.round(seconds)} s`;

const colonyCase = (island: ColonyDifficulty, level: DifficultyLevel, factor: number) => {
  const { ranks, size } = REFERENCE_FORCES[island];
  const force = typicalForce(Math.round(size * factor), { archers: true }, ranks);
  const outcomes: AssaultOutcome[] = withBalanceDifficulty(level, () =>
    seeds.map(seed => simulateColonyAssault({ difficulty: island, force, seed })));
  const summary = summarize(outcomes);
  row([island, level, Math.round(meanOf(outcomes.map(outcome => outcome.enemies ?? 0))), Math.round(size * factor),
    percent(summary.winRate), summary.meanLosses.toFixed(1), winTime(summary.meanWinSeconds)]);
};

const colonySection = () => {
  console.log(`\n### Colonies (scripted assault, mixed force, ${seeds.length} seeds)\n`);
  header(["Island", "Global", "Enemy soldiers", "Player force", "Win", "Losses", "Time to win"]);
  for (const island of ISLAND_LEVELS) for (const level of GLOBAL_LEVELS) {
    colonyCase(island, level, 1);
    if (level === "normal") continue;
    for (const growth of FORCE_GROWTH) colonyCase(island, level, DIFFICULTY_PROFILES[level].soldiers * growth);
  }
};

const adventureSection = () => {
  console.log(`\n### Adventures (enemy roster, seeds ${seeds.join(", ")})\n`);
  header(["Island", "Global", "Camp soldiers", "Mean rank", "Archer towers (mean)"]);
  for (const island of ISLAND_LEVELS) for (const level of DIFFICULTY_LEVELS) {
    const ranks = adventureEnemyPlan(island, level).camps.flatMap(camp => camp.ranks);
    const towers = meanOf(seeds.map(seed => adventureDefencePlan({ difficulty: island, seed }, level).length));
    row([island, level, ranks.length, meanOf(ranks).toFixed(2), towers.toFixed(1)]);
  }
};

/** The develop levels: the map's level at Normal, and Very hard as the global difficulty over a hard map. */
const DEVELOP_LEVELS: readonly { global?: DifficultyLevel; level: FactionAiLevel; name: string }[] = [
  { level: "easy", name: "easy" }, { level: "medium", name: "medium" }, { level: "hard", name: "hard" },
  { global: "veryHard", level: "hard", name: "veryHard" }
];

type Island = ReturnType<typeof createDevelopReferenceIsland>;
const aiSoldiers = ({ simulation }: Island) =>
  simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === REFERENCE_AI).length;
const aiBuildings = ({ simulation }: Island) => simulation.buildings()
  .filter(building => building.militaryFaction === REFERENCE_AI && building.construction === 1).length;
/** A director force of the faction on a strike or raid (the first AI attack). */
const attacking = ({ simulation }: Island) => simulation.saveState().military?.combat?.director?.factions
  .some(faction => faction.faction === REFERENCE_AI &&
    faction.forces.some(force => force.macro === "strike" || force.macro === "raid")) === true;

const developRun = (map: typeof DEVELOP_REFERENCE_MAPS[number], entry: typeof DEVELOP_LEVELS[number]) => {
  const island = createDevelopReferenceIsland(map, { level: entry.level }, entry.global);
  if (idlePlayerSite) placeIdlePlayerSite(island.simulation);
  const samples = new Map<number, { buildings: number; soldiers: number }>();
  let firstAttack: number | undefined, peak = 0;
  for (let second = 0; second < minutes * 60; second += SAMPLE_SECONDS) {
    for (let tick = 0; tick < SAMPLE_SECONDS * TICKS_PER_SECOND; tick++)
      island.simulation.update(1 / TICKS_PER_SECOND);
    const minute = (second + SAMPLE_SECONDS) / 60;
    peak = Math.max(peak, aiSoldiers(island));
    if (firstAttack === undefined && attacking(island)) firstAttack = minute;
    if (minute !== 30 && minute !== minutes) continue;
    samples.set(minute, { buildings: aiBuildings(island), soldiers: aiSoldiers(island) });
  }
  const at = (minute: number) => samples.get(minute);
  row([map.name, entry.name, firstAttack === undefined ? "none" : `${firstAttack.toFixed(1)} min`,
    `${at(30)?.soldiers ?? "–"} / ${at(minutes)?.soldiers ?? "–"}`, peak,
    `${at(30)?.buildings ?? "–"} / ${at(minutes)?.buildings ?? "–"}`]);
};

const developSection = () => {
  console.log(`\n### Develop economy AI (reference maps, ${minutes} game min)\n`);
  header(["Map", "Level", "First strike/raid", `AI soldiers 30 / ${minutes} min`, "Peak soldiers",
    `AI buildings 30 / ${minutes} min`]);
  for (const map of DEVELOP_REFERENCE_MAPS) for (const entry of DEVELOP_LEVELS) developRun(map, entry);
};

type Fixture = ReturnType<typeof createFactionAttackFixture>;
/** A director force of `faction` on a strike or raid (the first AI attack). */
const attacksFrom = (simulation: Fixture["simulation"], faction: number) =>
  simulation.saveState().military?.combat?.director?.factions.some(entry => entry.faction === faction &&
    entry.forces.some(force => force.macro === "strike" || force.macro === "raid")) === true;
const ATTACK_MINUTES = 20;

/** The EAI4b attack fixture (12 depot soldiers, the player's unmanned Guardhouse) per level. */
const attackRun = (level: FactionAiLevel) => {
  const { guardhouse, simulation } = createFactionAttackFixture({ level, mode: "develop" }, undefined, true);
  let firstAttack: number | undefined, taken: number | undefined;
  for (let second = SAMPLE_SECONDS; second <= ATTACK_MINUTES * 60; second += SAMPLE_SECONDS) {
    for (let tick = 0; tick < SAMPLE_SECONDS * TICKS_PER_SECOND; tick++) simulation.update(1 / TICKS_PER_SECOND);
    if (firstAttack === undefined && attacksFrom(simulation, ATTACK_FIXTURE_FACTION)) firstAttack = second / 60;
    const walls = simulation.militaryDoors().find(door => door.building === guardhouse)?.structure;
    if (taken === undefined && (!simulation.buildings().some(site => site.uid === guardhouse) || walls?.hp === 0))
      taken = second / 60;
  }
  const left = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === ATTACK_FIXTURE_FACTION);
  const minute = (value: number | undefined) => value === undefined ? "none" : `${value.toFixed(1)} min`;
  row([level, minute(firstAttack), minute(taken), left.length]);
};

const attackSection = () => {
  console.log(`\n### Attack fixture (EAI4b: 12 stored soldiers vs the player's Guardhouse, ${ATTACK_MINUTES} min)\n`);
  header(["Level", "First strike/raid", "Guardhouse fell", "AI soldiers left"]);
  for (const level of ["easy", "medium", "hard"] as const) attackRun(level);
};

if (sections.has("adventures")) adventureSection();
if (sections.has("attacks")) attackSection();
if (sections.has("colonies")) colonySection();
if (sections.has("develop")) developSection();
