import { navigationPropRadius } from "../../../settlement/navigation-prop-geometry";
import { getCellTerrain } from "../../generation/gameplay";
import type { MarbleDeposit } from "../../marble-deposit";
import { BLOCKING, PROP, PROP_REMOVED, type WorldData } from "../../world-data";
import { transformOreCells } from "./generated-feature-ore";
import type { FeatureTransformRuntime } from "./generated-feature-runtime";

interface ResourceTransform {
  cx: number;
  cz: number;
  offsetX: number;
  offsetZ: number;
  scale: number;
}

/** Plan complete finite sources before any terrain write, preserving exact quantities and IDs. */
export const planFeatureResources = (
  world: WorldData,
  cells: ReadonlySet<number>,
  attached: ReadonlySet<number>,
  transform: ResourceTransform,
  runtime?: FeatureTransformRuntime
) => {
  const zoneIds = new Set<number>();
  for (const cell of cells) if (world.mineZone[cell]) zoneIds.add(world.mineZone[cell]!);
  const sourceCells: number[] = [];
  // A zone the selection only touches moves whole: its deposit belongs to the moved feature.
  for (let cell = 0; cell < world.mineZone.length; cell++)
    if (zoneIds.has(world.mineZone[cell]!)) sourceCells.push(cell);
  for (const id of zoneIds) {
    const zone = world.mineZones[id - 1];
    if (!zone || zone.id !== id)
      throw new Error("The selected ore zone has an invalid saved identity.");
    const refusal = runtime?.canMoveResource?.("ore", id);
    if (refusal) throw new Error(refusal);
  }
  const depositIds = new Set<number>();
  const moving = new Set<MarbleDeposit>();
  const definitions = [
    ...(world.colonyStoneDeposits ?? []),
    ...(world.scenario?.marbleDeposits ?? [])
  ];
  for (const deposit of definitions) {
    const inside = cells.has(Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x));
    const propAttached = deposit.sourceProp !== undefined && attached.has(deposit.sourceProp);
    if (!inside && !propAttached) continue;
    // A source whose boulder moves comes along; one whose boulder stays behind cannot be split.
    if (deposit.sourceProp !== undefined && !propAttached)
      throw new Error("Select the entire finite stone source, including its boulder.");
    if (
      deposit.sourceProp !== undefined &&
      world.props.types[deposit.sourceProp] !== PROP.largeRock
    )
      throw new Error("The finite stone source has an invalid native boulder reference.");
    const refusal = runtime?.canMoveResource?.("stone", deposit.id);
    if (refusal) throw new Error(refusal);
    moving.add(deposit);
    depositIds.add(deposit.id);
  }
  const { centers, planned } = transformOreCells(world, sourceCells, transform);
  const mineZone = world.mineZone.slice(),
    oreAmount = world.oreAmount.slice();
  for (const cell of sourceCells) {
    mineZone[cell] = 0;
    oreAmount[cell] = 0;
  }
  for (const [cell, target] of planned) {
    mineZone[cell] = target.id;
    oreAmount[cell] = target.amount;
  }
  const destinations = [...planned.keys()];
  const movedDefinitions = new Set<MarbleDeposit>();
  const mapDeposits = (sources: MarbleDeposit[] | undefined) =>
    sources?.map((deposit) => {
      if (!moving.has(deposit)) return { ...deposit };
      const next = {
        ...deposit,
        x: Math.fround(
          transform.cx + (deposit.x - transform.cx) * transform.scale + transform.offsetX
        ),
        z: Math.fround(
          transform.cz + (deposit.z - transform.cz) * transform.scale + transform.offsetZ
        )
      };
      movedDefinitions.add(next);
      return next;
    });
  const colonyStoneDeposits = mapDeposits(world.colonyStoneDeposits);
  const scenarioDeposits = mapDeposits(world.scenario?.marbleDeposits);
  // Protection ignores only resources owned by this transaction; plots, roads and other sources remain guarded.
  const protectionWorld: WorldData = {
    ...world,
    mineZone: world.mineZone.map((id) => (zoneIds.has(id) ? 0 : id)),
    colonyStoneDeposits: world.colonyStoneDeposits?.filter((deposit) => !moving.has(deposit)),
    scenario: world.scenario
      ? {
          ...world.scenario,
          marbleDeposits: world.scenario.marbleDeposits?.filter((deposit) => !moving.has(deposit))
        }
      : undefined
  };
  const validate = (candidate: WorldData, protectedVertices: ReadonlySet<number>) => {
    const clearCell = (x: number, z: number) => {
      const terrain = getCellTerrain(candidate, candidate, x, z);
      if (terrain.blocking === BLOCKING.water)
        throw new Error("Finite resources cannot be moved below water.");
      const stride = world.cellsX + 1;
      for (const vertex of [
        z * stride + x,
        z * stride + x + 1,
        (z + 1) * stride + x,
        (z + 1) * stride + x + 1
      ])
        if (protectedVertices.has(vertex))
          throw new Error(
            "The moved finite resource overlaps a protected plot, route or active job."
          );
    };
    for (const cell of destinations)
      clearCell(cell % world.cellsX, Math.floor(cell / world.cellsX));
    const targets = [...(colonyStoneDeposits ?? []), ...(scenarioDeposits ?? [])];
    for (const deposit of targets) {
      if (!movedDefinitions.has(deposit)) continue;
      if (
        deposit.x < 1 ||
        deposit.z < 1 ||
        deposit.x >= world.cellsX - 1 ||
        deposit.z >= world.cellsZ - 1
      )
        throw new Error("Finite stone sources must remain inside the map.");
      clearCell(Math.floor(deposit.x), Math.floor(deposit.z));
      if (
        getCellTerrain(candidate, candidate, Math.floor(deposit.x), Math.floor(deposit.z))
          .blocking !== BLOCKING.free
      )
        throw new Error("Finite stone sources need dry accessible destination ground.");
      for (let prop = 0; prop < world.props.count; prop++) {
        if (attached.has(prop) || world.props.types[prop] === PROP_REMOVED) continue;
        const radius = navigationPropRadius(world, prop);
        if (radius <= 0) continue;
        if (
          Math.hypot(deposit.x - world.props.x[prop]!, deposit.z - world.props.z[prop]!) <
          1 + radius
        )
          throw new Error("The finite stone source would overlap an unrelated native prop.");
      }
      for (const other of targets) {
        if (other === deposit || other.id === deposit.id) continue;
        if (Math.hypot(deposit.x - other.x, deposit.z - other.z) < 2)
          throw new Error("Finite stone sources need separate destination plots.");
      }
    }
  };
  const commit = () => {
    if (sourceCells.length) {
      world.mineZone.set(mineZone);
      world.oreAmount.set(oreAmount);
      for (const zone of world.mineZones) {
        if (!zoneIds.has(zone.id)) continue;
        Object.assign(zone, centers.get(zone.id));
      }
    }
    if (moving.size) {
      world.colonyStoneDeposits = colonyStoneDeposits;
      if (world.scenario) world.scenario = { ...world.scenario, marbleDeposits: scenarioDeposits };
    }
  };
  return { commit, depositIds, protectionWorld, validate, zoneIds };
};
