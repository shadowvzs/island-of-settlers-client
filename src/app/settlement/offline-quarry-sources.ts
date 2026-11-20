import type { Goods } from "../../../../island-of-settlers-shared/src/goods";
import { STONE_SOURCE_REST_SECONDS } from "../../shared/balance/resources";
import { canRespawnStoneAt, type StoneRespawnPlacementContext } from "../../shared/settlement/boulder-respawn";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import { inFarmArea } from "../../shared/settlement/settlement-farm-area";
import type { ResourceTarget, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { resourceWorkRadius } from "../../shared/settlement/settlement-work-ranges";
import { restoreRemovedProp } from "../../shared/world/editing/prop-placement";
import { BLOCKING, PROP, type WorldData } from "../../shared/world/world-data";
import type { createIslandStoneDeposits } from "./island-stone-deposits";
import type { OfflineEconomyEventsOptions, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";
import { DMath } from "../../shared/math/deterministic-math";

type Completed = NonNullable<OfflineEconomyEventsOptions["onCompleted"]>;
interface Source {
  target: ResourceTarget;
  token: string;
  receipt: string;
  quantum: number;
  initial: number;
  held: number;
  renewable: boolean;
  rest: number;
  extracted: number;
  depletedAt: number;
}

/** Each real stone identity has one budget and one rest timer, shared by overlapping quarries.
 * Extraction receipts are produced at completion, so transport delays cannot start a rest early.
 */
export const prepareOfflineQuarrySources = (options: {
  save: GameSaveV1; world: WorldData; jobs: OfflineEconomyJob[]; seconds: number;
  ledger: () => ReturnType<typeof createIslandStoneDeposits>;
  reserved: Set<string>; claimed: Set<string>;
  accessible: (building: SettlementBuilding, target: ResourceTarget) => boolean;
}) => {
  const { accessible, claimed, jobs, reserved, save, seconds, world } = options;
  const stock: Goods = {}, capacities: Goods = {}, sourceJobs: OfflineEconomyJob[] = [];
  const managedKeys = new Set<string>(), sources = new Map<number, Source>();
  const receipts = new Map<string, Source>(), identities = new Map<string, Source>();
  const quarries = save.settlement.buildings.filter(building => building.typeId === 19)
    .flatMap(building => {
      const input = `~source:${building.uid}`, job = jobs.find(job => job.inputs[input] === 1);
      return job ? [{ building, input, job }] : [];
    });
  const pool = quarries[0]?.input;
  const ledger = pool && save.runtime && world.colonyResourceTier === undefined ? options.ledger() : undefined;
  const put = (key: string, amount: number, capacity?: number) => {
    managedKeys.add(key); stock[key] = amount;
    if (capacity !== undefined) capacities[key] = capacity;
  };
  if (pool && ledger) {
    const roads = createRoadNetwork(world);
    if (!roads.replaceSegments(save.settlement.roads)) throw new Error("Invalid offline quarry roads");
    const fieldCells = new Set(save.settlement.fields.filter(field => field.state !== "stubble")
      .map(field => Math.floor(field.z) * world.cellsX + Math.floor(field.x)));
    const placement: StoneRespawnPlacementContext = { options: { world, roads, stoneSources: ledger },
      occupied: savedOccupancy(save.settlement), reservations: reserved,
      buildings: save.settlement.buildings, actors: save.settlement.actors,
      fieldCycles: { isOccupied: (x, z) => fieldCells.has(Math.floor(z) * world.cellsX + Math.floor(x)) } };
    const canRenew = (target: ResourceTarget) => {
      // Evaluate a standing boulder's future depleted cell without changing the real world.
      let context = placement;
      const cell = Math.floor(target.z) * world.cellsX + Math.floor(target.x);
      if (target.id >= 0 && world.props.types[target.id] === PROP.largeRock && world.blocking[cell] === BLOCKING.prop) {
        const blocking = world.blocking.slice(); blocking[cell] = BLOCKING.free;
        context = { ...placement, options: { ...placement.options, world: { ...world, blocking } } };
      }
      const spot = ledger.spot(target.id);
      return !!spot && canRespawnStoneAt(context, target.id >= 0 ? "prop" : "island", target.id, spot);
    };
    put(pool, 0, 0);
    for (const { building, input, job } of quarries) {
      const choices: NonNullable<OfflineEconomyJob["sourceChoices"]>["choices"] = [];
      for (const target of ledger.targets(building.access, resourceWorkRadius("stone"), true)) {
        if (!ledger.canConsume(target, true) || !accessible(building, target)) continue;
        const area = save.settlement.stoneAreas.find(([uid]) => uid === building.uid)?.[1];
        // The source adapter passes the same selected-area predicate used by its other sources.
        if (area && !inFarmArea(area, target)) continue;
        let source = sources.get(target.id);
        if (!source) {
          const identity = target.id >= 0 ? `prop:${target.id}` : `stone:${target.id}`;
          if (claimed.has(identity)) continue;
          claimed.add(identity);
          const initial = ledger.remaining(target), quantum = ledger.freshAmount(target);
          if (!quantum) continue;
          const held = Math.min(initial, Number(reserved.has(`stone:${target.id}`)));
          const timer = save.settlement.stoneRespawns?.find(entry => entry.id === target.id &&
            entry.kind === (target.id >= 0 ? "prop" : "island"));
          const rest = timer?.restSeconds ?? 0;
          source = { target, quantum, initial, held, rest, token: `~quarry:available:${target.id}`,
            receipt: `~quarry:extracted:${target.id}`, extracted: Math.max(0, quantum - initial),
            depletedAt: initial ? 0 : -rest * TPS,
            renewable: !held && initial <= quantum && canRenew(target) };
          sources.set(target.id, source); receipts.set(source.receipt, source); identities.set(source.token, source);
          const available = initial - held;
          put(source.token, available, Math.max(available, quantum));
          put(source.receipt, Math.max(0, quantum - initial));
          stock[pool]! += available; capacities[pool]! += Math.max(available, quantum);
          if (source.renewable) {
            const gate = `~quarry:renewable:${target.id}`;
            put(gate, Number(initial > 0));
            const outputs = { [source.token]: quantum, [pool]: quantum, [gate]: 1 };
            if (!initial) {
              const remainingTicks = Math.max(1, Math.ceil((STONE_SOURCE_REST_SECONDS - rest) * TPS));
              sourceJobs.push({ uid: `quarry-rest:${target.id}`, islandId: job.islandId,
                cycleTicks: remainingTicks, inputs: { [source.receipt]: quantum }, outputs,
                outputSequence: [outputs] });
            }
            sourceJobs.push({ uid: `quarry-renew:${target.id}`, islandId: job.islandId,
              cycleTicks: STONE_SOURCE_REST_SECONDS * TPS,
              inputs: { [source.receipt]: quantum, [gate]: 1 }, outputs });
          }
        }
        choices.push({ token: source.token,
          priority: DMath.hypot(target.x - building.access.x, target.z - building.access.z),
          outputs: { [source.receipt]: 1 } });
      }
      delete job.inputs[input]; job.inputs[pool] = 1;
      job.sourceChoices = { input: pool, choices };
    }
  }
  const resetCompleted = () => {
    for (const source of sources.values()) {
      source.extracted = Math.max(0, source.quantum - source.initial);
      source.depletedAt = source.initial ? 0 : -source.rest * TPS;
    }
  };
  const onCompleted: Completed = (_job, tick, _inputs, outputs) => {
    for (const [key, amount] of Object.entries(outputs)) {
      const source = receipts.get(key);
      if (source) {
        source.extracted += amount;
        if (source.extracted === source.quantum) source.depletedAt = tick;
      }
      const replenished = identities.get(key);
      if (replenished && amount) replenished.extracted = 0;
    }
  };
  const validate = (consumed: Goods, finalStock: Goods | undefined, produced: Goods) => {
    let usedPool = 0, madePool = 0;
    for (const source of sources.values()) {
      const used = consumed[source.token] ?? 0, made = produced[source.token] ?? 0;
      const available = source.initial - source.held + made - used;
      if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(made) || made < 0 ||
        made % source.quantum || available < 0 ||
        (finalStock && available !== (finalStock[source.token] ?? 0)) ||
        (made > 0 && (!source.renewable || !finalStock || available > source.quantum)) ||
        (produced[source.receipt] ?? 0) !== used || (consumed[source.receipt] ?? 0) !== made)
        throw new Error(`Offline quarry identity balance invalid: ${source.target.id}`);
      usedPool += used; madePool += made;
    }
    if (pool && ((consumed[pool] ?? 0) !== usedPool || (produced[pool] ?? 0) !== madePool))
      throw new Error("Offline quarry aggregate balance invalid");
    for (const key of managedKeys) {
      const balance = (stock[key] ?? 0) + (produced[key] ?? 0) - (consumed[key] ?? 0);
      if (!Number.isSafeInteger(balance) || balance < 0 ||
        (finalStock && balance !== (finalStock[key] ?? 0)))
        throw new Error(`Offline quarry token balance invalid: ${key}`);
    }
  };
  const apply = (consumed: Goods, finalStock: Goods | undefined, produced: Goods) => {
    validate(consumed, finalStock, produced);
    const timers = save.settlement.stoneRespawns ??= [];
    // Unmodeled island sources retain elapsed rest; native continuation resolves their geometry.
    for (const entry of timers) if (entry.kind !== "deposit" && !sources.has(entry.id))
      entry.restSeconds = Math.min(STONE_SOURCE_REST_SECONDS, entry.restSeconds + seconds);
    for (const source of sources.values()) {
      const used = consumed[source.token] ?? 0, made = produced[source.token] ?? 0;
      const remaining = source.initial + made - used;
      let cuts = used;
      if (made) {
        if (source.target.id >= 0 && world.props.types[source.target.id] !== PROP.largeRock &&
          !restoreRemovedProp(world, source.target.id, PROP.largeRock))
          throw new Error("Offline quarry boulder could not regrow");
        ledger!.refill(source.target.id);
        cuts = source.quantum - remaining;
      }
      for (let unit = 0; unit < cuts; unit++) if (!ledger!.consume(source.target))
        throw new Error(`Offline quarry source changed after planning: ${source.target.id}`);
      const kind = source.target.id >= 0 ? "prop" : "island";
      const at = timers.findIndex(entry => entry.kind === kind && entry.id === source.target.id);
      if (remaining > 0) { if (at >= 0) timers.splice(at, 1); }
      else {
        const restSeconds = Math.max(0, Math.min(STONE_SOURCE_REST_SECONDS, seconds - source.depletedAt / TPS));
        if (at >= 0) timers[at]!.restSeconds = restSeconds;
        else timers.push({ id: source.target.id, kind, restSeconds });
      }
    }
  };
  return { stock, capacities, jobs: sourceJobs, managedKeys, resetCompleted, onCompleted, validate, apply };
};
