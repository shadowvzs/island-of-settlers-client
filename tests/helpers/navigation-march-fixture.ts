import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { hashText } from "../../src/shared/settlement/settlement-state-hash";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { spawnAround } from "../../tools/bench/garrison-balance-harness";
import { readDevelopedFixture } from "./developed-fixture";

/** Rally points west, east, north and south of the developed fixture's town. */
const WEST = { x: 50.5, z: 50.5 };
const EAST = { x: 112.5, z: 54.5 };
const NORTH = { x: 80.5, z: 22.5 };
const SOUTH = { x: 80.5, z: 88.5 };
/** Mixed troops: queued (more than 8) and immediate groups, foot and mounted flow fields. */
const LARGE: readonly MilitaryTroopType[] = ["shield", "cavalry", "heavy", "shield", "archer", "cavalry",
  "shield", "heavy", "cavalry", "shield", "archer", "shield"];
const SMALL: readonly MilitaryTroopType[] = ["cavalry", "shield", "cavalry", "heavy", "cavalry", "shield"];
/** Ticks between the march orders (each order turns every group round). */
const ORDER_TICKS = 400;

interface MarchGroup { ids: number[]; there: SettlementPoint; home: SettlementPoint }

const spawnGroup = (simulation: Awaited<ReturnType<typeof createHeadlessIsland>>["simulation"],
  types: readonly MilitaryTroopType[], home: SettlementPoint, there: SettlementPoint): MarchGroup =>
  ({ home, ids: types.map(type => spawnAround(simulation, home, type, 0, 1)), there });

/**
 * The developed demo island (live economy: stock churn, felling, planting, fields) crossed by three
 * computer groups that turn round every 20 s. Returns the final settlement save text and its hash.
 */
export const developedMarchRun = async (seconds: number, beforeTick?: (tick: number) => void) => {
  const source = await readDevelopedFixture();
  const { simulation } = await createHeadlessIsland(source);
  const groups = [spawnGroup(simulation, LARGE, WEST, EAST), spawnGroup(simulation, SMALL, EAST, WEST),
    spawnGroup(simulation, LARGE.slice(0, 8), NORTH, SOUTH)];
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (tick % ORDER_TICKS === 0) {
      const outward = (tick / ORDER_TICKS) % 2 === 0;
      for (const group of groups)
        simulation.commandMilitaryOpponent(group.ids, outward ? group.there : group.home, 1, "move");
    }
    beforeTick?.(tick);
    simulation.update(0.05);
  }
  const text = JSON.stringify(simulation.saveState());
  return { hash: hashText(text), text };
};
