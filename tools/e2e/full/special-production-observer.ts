import { HANDCART_LOGISTICS } from "../../../src/shared/balance/economy";
import { isMaterialForester } from "../../../src/shared/settlement/advanced-material-production";
import { TREE_PROPS } from "../../../src/shared/world/editing/prop-removal";

type Live = { world: any; settlement: any };
type Tick = { actors: any[]; building: any; now: number };
type Proof = Record<string, unknown>;
const treeKinds = TREE_PROPS;

const forestryObserver = (live: Live, uid: number) => {
  const trees = new Map<number, { id: number; plantedAt: number; target: { x: number; z: number }; matureAt?: number }>();
  let count = live.world.props.count, target: { x: number; z: number } | undefined;
  return {
    tick: ({ actors, now }: Tick) => {
      const worker = actors.find(actor => actor.building === uid && actor.target?.kind === "plant");
      if (worker) target = { x: worker.target.x, z: worker.target.z };
      for (let id = count; id < live.world.props.count; id++) {
        const props = live.world.props;
        if (trees.size < 16 && target && treeKinds.has(props.types[id]) &&
          Math.hypot(props.x[id] - target.x, props.z[id] - target.z) < .05 &&
          live.settlement.growth.isGrowing(id)) trees.set(id, { id, plantedAt: now, target: { ...target } });
      }
      count = live.world.props.count;
      for (const tree of trees.values()) if (!tree.matureAt && treeKinds.has(live.world.props.types[tree.id]) &&
        live.settlement.growth.isGrown(tree.id)) tree.matureAt = now;
    },
    read: () => ({ completed: [...trees.values()].filter(tree => tree.matureAt).length,
      proofs: [...trees.values()], scope: "This forester's exact planted targets, new prop IDs and shared growth maturity" })
  };
};

const boatObserver = (uid: number) => {
  const previous = new Map<number, any>(), boats = new Map<number, any>(), proofs: Proof[] = [];
  return {
    tick: ({ actors, now }: Tick) => {
      for (const actor of actors.filter(actor => actor.building === uid && actor.job === "Shipwright")) {
        const old = previous.get(actor.uid);
        if (actor.phase === "boatInputPickup" && old?.phase !== actor.phase && actor.consumed?.planks === 1)
          boats.set(actor.uid, { actor: actor.uid, paidPlanks: 1, paidAt: now });
        const receipt = boats.get(actor.uid);
        if (receipt && actor.phase === "boatWork") receipt.workObserved = true;
        if (receipt?.workObserved && old?.phase === "enterHome" && old.ware === "boat" &&
          !actor.ware && actor.boatWork === -1) {
          if (proofs.length < 8) proofs.push({ ...receipt, storage: actor.home, depositedAt: now });
          boats.delete(actor.uid);
        }
        previous.set(actor.uid, { phase: actor.phase, ware: actor.ware });
      }
    },
    read: () => ({ completed: proofs.length, proofs, scope: "Same shipwright: paid plank, real work and HQ boat deposit" })
  };
};

const cartObserver = (live: Live, uid: number) => {
  const previous = new Map<number, any>(), carts = new Map<number, any>(), proofs: Proof[] = [];
  let paidCrafts = 0, workReceipt = false;
  return {
    tick: ({ actors, building, now }: Tick) => {
      const worker = actors.find(actor => actor.uid === building.worker);
      if (worker?.productionOutput === "handcart" && worker.phase === "work" &&
        worker.consumed?.logs === HANDCART_LOGISTICS.cost.logs)
        workReceipt = true;
      if (workReceipt && worker && worker.productionOutput !== "handcart") { paidCrafts++; workReceipt = false; }
      for (const actor of actors) {
        const old = previous.get(actor.uid), cart = actor.handcart;
        if (cart && !old?.cart && !cart.trip && cart.state === "parked" &&
          paidCrafts > carts.size + proofs.length && cart.parked &&
          Math.hypot(cart.parked.x - building.access.x, cart.parked.z - building.access.z) < 3)
          carts.set(actor.uid, { actor: actor.uid, owner: cart.owner, source: uid, fetchedAt: now });
        const receipt = carts.get(actor.uid);
        if (receipt) Object.assign(receipt, { lastPhase: actor.phase, lastState: cart?.state });
        if (receipt && old?.cart && !cart) {
          const storage = live.settlement.simulation.buildings().find((b: any) => b.uid === receipt.owner);
          if (storage && [0, 29, 39].includes(storage.typeId) &&
            Math.hypot(actor.x - storage.access.x, actor.z - storage.access.z) < .1 &&
            (storage.handcarts ?? 0) > (old.stored ?? 0)) {
            if (proofs.length < 8) proofs.push({ ...receipt, shelvedAt: now });
            carts.delete(actor.uid);
          }
        }
        if (cart || old?.cart || carts.has(actor.uid)) previous.set(actor.uid, { cart: !!cart,
          stored: live.settlement.simulation.buildings().find((b: any) => b.uid === cart?.owner)?.handcarts ?? 0 });
      }
    },
    read: () => ({ completed: proofs.length, paidCrafts, proofs, pending: [...carts.values()],
      scope: "Sole active cart yard: paid work receipt, cart collected at that yard and physically shelved by same carrier" })
  };
};

const shipObserver = (live: Live, uid: number) => {
  const sim = live.settlement.simulation;
  const knownShips = new Set(sim.ships().map((ship: any) => ship.id));
  const initialSites = new Set(sim.shipSites().map((site: any) => site.id));
  const sites = new Map<number, any>(), proofs: Proof[] = [], previous = new Map<number, string>();
  let paidPlanks = 0;
  return {
    tick: ({ actors, now }: Tick) => {
      for (const actor of actors.filter(actor => actor.building === uid && actor.job === "Shipwright")) {
        if (actor.phase === "shipInputPickup" && previous.get(actor.uid) !== actor.phase && actor.ware === "planks") paidPlanks++;
        previous.set(actor.uid, actor.phase);
      }
      for (const site of sim.shipSites()) if (site.id > 0 && !site.kind && !initialSites.has(site.id) &&
        site.progress >= 0 && site.progress <= 1) {
        const old = sites.get(site.id);
        sites.set(site.id, { id: site.id, x: site.x, z: site.z,
          minimum: Math.min(old?.minimum ?? Infinity, site.progress), maximum: Math.max(old?.maximum ?? 0, site.progress) });
      }
      for (const ship of sim.ships()) {
        if (knownShips.has(ship.id)) continue;
        knownShips.add(ship.id);
        if (ship.visitor) continue;
        const source = [...sites.values()].find(site => site.minimum <= .1 && site.maximum >= .9 &&
          Math.hypot(ship.x - site.x, ship.z - site.z) < 1);
        if (source) {
          if (proofs.length < 8) proofs.push({ ship: ship.id, source: uid, hull: source, launchedAt: now });
          sites.delete(source.id);
        }
      }
    },
    read: () => ({ completed: proofs.length, paidPlanks, proofs, pendingHulls: [...sites.values()],
      scope: "Sole fleet-building yard: new hull progress, plank pickups and new nonvisitor ship at that launch" })
  };
};

/** Test-only sampler; all mutations are confined to its own bounded evidence buffers. */
const chooseObserver = (live: Live, uid: number, typeId: number, mode: string) => {
  if (typeId === 20 || isMaterialForester(typeId)) return forestryObserver(live, uid);
  if (mode === "boats") return boatObserver(uid);
  if (mode === "handcart") return cartObserver(live, uid);
  return shipObserver(live, uid);
};
export const createSpecialProductionObserver = (live: Live, uid: number, typeId: number, mode: string) => {
  const observer = chooseObserver(live, uid, typeId, mode);
  let stopped = false, last = performance.now(), maximumGapMs = 0;
  const sample = () => {
    const now = performance.now(), sim = live.settlement.simulation;
    maximumGapMs = Math.max(maximumGapMs, now - last); last = now;
    const building = sim.buildings().find((entry: any) => entry.uid === uid);
    if (building) observer.tick({ actors: sim.frames(), building, now });
    if (!stopped) requestAnimationFrame(sample);
  };
  sample();
  return { stop: () => { stopped = true; }, read: () => ({ ...observer.read(), maximumGapMs }) };
};
