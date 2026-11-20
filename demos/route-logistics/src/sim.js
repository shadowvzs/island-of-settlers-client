// oxlint-disable max-lines
/**
 * Route-bound flag logistics demo.
 *
 * This module is deliberately dependency-free so the same simulation can run in the browser
 * demo and under `node --test`. The browser layer only draws state and sends commands here.
 */

export const WARE_COLORS = {
  logs: "#8a5a2b", planks: "#c9975a", stone: "#9aa0a6", fish: "#4aa3c7", bread: "#d9a441",
  water: "#4f8fe8", grain: "#d6c45a", flour: "#e7dcc0", coal: "#4b4b52", ironOre: "#8b6f5a",
  iron: "#b7bcc4", pig: "#d88a93", meat: "#c45b62", hides: "#9b6b43", leather: "#a9713f",
  armor: "#8f9aa8", sword: "#c8ced8", shield: "#8d6b4a", bow: "#9c7b48", axe: "#7c8792",
  saw: "#aab3bd", pickaxe: "#7c8792", shovel: "#8f9aa8", hammer: "#9aa0a6", fishingRod: "#9c7b48",
  scythe: "#8f9aa8", crucible: "#b08a4f", tongs: "#8f9aa8", rollingPin: "#c9975a", cleaver: "#9aa0a6",
  beer: "#c98a2e", wine: "#8d3f5e", grapes: "#7d4a8f", horse: "#8b6a4a", boat: "#6f8fa8",
  coins: "#e0b94b", goldOre: "#d4af37"
};

export const DEFAULT_OPTIONS = {
  routeCount: 6,
  cartCapacity: 8,
  flagTotalCapacity: 18,
  flagWareCapacity: 6,
  hubTotalCapacity: 500,
  hubWareCapacity: 100,
  carrierSpeed: 5,
  workerSpeed: 6,
  serviceSetupSeconds: 0.25,
  transferSeconds: 0.5,
  transferAnimationSeconds: 0.35,
  hubDocks: 2,
  hubCapacity: 500,
  hubDemandCapacity: 100,
  productionScale: 1.5,
  surplusSinkSeconds: 15,
  surplusThreshold: 25,
  targetInputStock: 2,
  smartSkip: false,
  eventCarriers: false
};

const HUB_TYPES = new Set([0, 29, 39]);
const SOLDIER_TYPES = new Set([1, 2, 4, 9]);
const TAVERN_TYPE = 40;
const HARBOR_TYPE = 39;
const HQ_TYPE = 0;

const keyOf = (x, z) => `${x.toFixed(3)},${z.toFixed(3)}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const sumValues = map => [...map.values()].reduce((sum, value) => sum + value, 0);
const sortedEntries = map => [...map.entries()].filter(([, value]) => value).sort(([a], [b]) => a.localeCompare(b));
const mapCopy = map => new Map(map);

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node) {
    const items = this.items;
    items.push(node);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= node.priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = node;
  }
  pop() {
    const items = this.items;
    if (!items.length) return undefined;
    const root = items[0], last = items.pop();
    if (items.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        if (left >= items.length) break;
        const child = right < items.length && items[right].priority < items[left].priority ? right : left;
        if (items[child].priority >= last.priority) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
    }
    return root;
  }
}

class RoadGraph {
  constructor(segments) {
    this.nodes = new Map();
    for (const segment of segments) this.addEdge(segment.a, segment.b);
  }

  node(x, z) {
    const key = keyOf(x, z);
    let node = this.nodes.get(key);
    if (!node) {
      node = { key, x, z, edges: [] };
      this.nodes.set(key, node);
    }
    return node;
  }

  addEdge(a, b) {
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) return;
    const first = this.node(a.x, a.z), second = this.node(b.x, b.z);
    if (first.edges.some(edge => edge.to === second.key)) return;
    const length = distance(first, second);
    first.edges.push({ to: second.key, length });
    second.edges.push({ to: first.key, length });
  }

  nearest(x, z) {
    let best = null, bestDistance = Infinity;
    for (const node of this.nodes.values()) {
      const next = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (next < bestDistance) { bestDistance = next; best = node; }
    }
    return best;
  }

  shortestPath(a, b) {
    const start = this.nearest(a.x, a.z), end = this.nearest(b.x, b.z);
    if (!start || !end) return null;
    if (start.key === end.key) return [{ x: start.x, z: start.z }];
    const dist = new Map([[start.key, 0]]);
    const previous = new Map();
    const heap = new MinHeap();
    heap.push({ key: start.key, priority: 0 });
    const visited = new Set();
    while (heap.size) {
      const current = heap.pop();
      if (visited.has(current.key)) continue;
      visited.add(current.key);
      if (current.key === end.key) break;
      const node = this.nodes.get(current.key);
      for (const edge of node.edges) {
        if (visited.has(edge.to)) continue;
        const nextDistance = dist.get(current.key) + edge.length;
        if (nextDistance < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nextDistance);
          previous.set(edge.to, current.key);
          heap.push({ key: edge.to, priority: nextDistance });
        }
      }
    }
    if (!dist.has(end.key)) return null;
    const keys = [];
    for (let key = end.key; key !== undefined; key = previous.get(key)) {
      keys.push(key);
      if (key === start.key) break;
    }
    keys.reverse();
    return keys.map(key => {
      const node = this.nodes.get(key);
      return { x: node.x, z: node.z };
    });
  }
}

const cumulative = points => {
  const values = [0];
  for (let index = 1; index < points.length; index++)
    values.push(values[index - 1] + distance(points[index - 1], points[index]));
  return values;
};

const pointAt = (points, cumulativeLengths, travelled) => {
  if (travelled <= 0) return points[0];
  const last = cumulativeLengths[cumulativeLengths.length - 1];
  if (travelled >= last) return points[points.length - 1];
  let low = 1, high = cumulativeLengths.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulativeLengths[middle] < travelled) low = middle + 1; else high = middle;
  }
  const index = low;
  const span = cumulativeLengths[index] - cumulativeLengths[index - 1] || 1;
  const amount = (travelled - cumulativeLengths[index - 1]) / span;
  const first = points[index - 1], second = points[index];
  return { x: first.x + (second.x - first.x) * amount, z: first.z + (second.z - first.z) * amount };
};

const clusterPoints = (points, routeCount, hub) => {
  if (!points.length) return [];
  const count = Math.max(1, Math.min(routeCount, points.length));
  const angle = point => Math.atan2(point.z - hub.z, point.x - hub.x);
  const sorted = [...points].sort((a, b) => angle(a) - angle(b) || a.uid - b.uid);
  let centroids = Array.from({ length: count }, (_, index) => {
    const point = sorted[Math.floor(index * sorted.length / count)];
    return { x: point.x, z: point.z };
  });
  let clusters = [];
  for (let iteration = 0; iteration < 20; iteration++) {
    clusters = Array.from({ length: count }, () => []);
    for (const point of points) {
      let best = 0, bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const next = (point.x - centroid.x) ** 2 + (point.z - centroid.z) ** 2;
        if (next < bestDistance) { bestDistance = next; best = index; }
      });
      clusters[best].push(point);
    }
    for (let index = 0; index < count; index++) {
      if (clusters[index].length) continue;
      let farthest = null, farthestDistance = -1, from = -1;
      clusters.forEach((cluster, clusterIndex) => {
        for (const point of cluster) {
          const next = (point.x - centroids[clusterIndex].x) ** 2 + (point.z - centroids[clusterIndex].z) ** 2;
          if (next > farthestDistance && cluster.length > 1) {
            farthestDistance = next; farthest = point; from = clusterIndex;
          }
        }
      });
      if (farthest && from >= 0) {
        clusters[from] = clusters[from].filter(point => point !== farthest);
        clusters[index] = [farthest];
      }
    }
    centroids = clusters.map((cluster, index) => cluster.length ? {
      x: cluster.reduce((sum, point) => sum + point.x, 0) / cluster.length,
      z: cluster.reduce((sum, point) => sum + point.z, 0) / cluster.length
    } : centroids[index]);
  }
  return clusters.filter(cluster => cluster.length);
};

const orderCluster = (hub, cluster) => {
  const remaining = [...cluster], ordered = [];
  let current = { x: hub.x, z: hub.z };
  while (remaining.length) {
    let best = 0, bestDistance = Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const next = distance(current, remaining[index]);
      if (next < bestDistance) { bestDistance = next; best = index; }
    }
    const next = remaining.splice(best, 1)[0];
    ordered.push(next);
    current = next;
  }
  return ordered;
};

const routePalette = ["#e07a4f", "#4f8fe0", "#6aa84f", "#c05a9e", "#d1a33a", "#4fb3a8", "#9a6ad1", "#d15a5a"];

const demandFor = building => {
  if (building.role === "home") return ["bread", "fish", "water"];
  if (SOLDIER_TYPES.has(building.typeId)) return ["coins", "sword"];
  if (building.typeId === TAVERN_TYPE) return ["beer", "wine"];
  if (building.typeId === HARBOR_TYPE) return ["boat"];
  return [];
};

const consumeSecondsFor = building => {
  if (building.role === "home") return 32;
  if (SOLDIER_TYPES.has(building.typeId)) return 45;
  if (building.typeId === TAVERN_TYPE) return 28;
  if (building.typeId === HARBOR_TYPE) return 90;
  return 30;
};

const flagCapacities = (building, options) => HUB_TYPES.has(building.typeId)
  ? { total: options.hubTotalCapacity, ware: options.hubWareCapacity }
  : { total: options.flagTotalCapacity, ware: options.flagWareCapacity };

/** Cart body half-width plus kerb clearance; a bay inside this envelope is not off-road. */
const CART_BAY_CLEARANCE = 0.36 + 0.06;
const insidePlotEnvelope = (building, point, margin = CART_BAY_CLEARANCE) =>
  Math.abs(point.x - building.x) <= building.width / 2 + margin &&
  Math.abs(point.z - building.z) <= building.depth / 2 + margin;

/**
 * The 0.8 inward bay sat inside 36/39 fixture plots. A shared bay belongs beside the road, clear of
 * every plot; demo routes use this static point exactly as the production selector does.
 */
const segmentStart = segment => segment.start ?? segment.a;
const segmentEnd = segment => segment.end ?? segment.b;
const segmentDistance = (point, segment) => {
  const start = segmentStart(segment), end = segmentEnd(segment);
  const dx = end.x - start.x, dz = end.z - start.z;
  const squared = dx * dx + dz * dz;
  if (squared < 1e-9) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / squared));
  return Math.hypot(point.x - start.x - dx * t, point.z - start.z - dz * t);
};

const chooseFlagBay = (building, buildings, roads = []) => {
  const access = building.access;
  const nearest = roads.reduce((best, segment) => {
    const distance = segmentDistance(access, segment);
    return !best || distance < best.distance ? { distance, segment } : best;
  }, undefined);
  const start = nearest && segmentStart(nearest.segment), end = nearest && segmentEnd(nearest.segment);
  const dx = start ? end.x - start.x : building.x - access.x;
  const dz = start ? end.z - start.z : building.z - access.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length, tz = dz / length, nx = tz, nz = -tx;
  const minLane = 0.6 + CART_BAY_CLEARANCE;
  for (const side of [1, -1])
    for (const along of [0, .5, -.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4])
      for (const lane of [minLane, minLane + .12, minLane + .36, minLane + .72, minLane + 1.2]) {
        const point = { x: access.x + tx * along + nx * side * lane,
          z: access.z + tz * along + nz * side * lane };
        if (Math.hypot(point.x - access.x, point.z - access.z) > 6) continue;
        if ([...buildings].every(other => !insidePlotEnvelope(other, point))) return point;
      }
  return { x: access.x, z: access.z };
};

const createFlag = (building, options, buildings = [], roads = []) => {
  const capacity = flagCapacities(building, options);
  const bay = chooseFlagBay(building, buildings, roads);
  return {
    uid: building.uid,
    x: bay.x,
    z: bay.z,
    accessX: building.access.x,
    accessZ: building.access.z,
    totalCapacity: capacity.total,
    wareCapacity: capacity.ware,
    stock: new Map(),
    reserved: new Map(),
    bay: null,
    queue: [],
    full: false,
    empty: true,
    fullSeconds: 0,
    emptySeconds: 0
  };
};

const canDeposit = (flag, ware, amount = 1) => {
  const total = sumValues(flag.stock) + sumValues(flag.reserved);
  return total + amount <= flag.totalCapacity &&
    (flag.stock.get(ware) ?? 0) + (flag.reserved.get(ware) ?? 0) + amount <= flag.wareCapacity;
};

const reserve = (flag, ware, amount = 1) => {
  if (!canDeposit(flag, ware, amount)) return false;
  flag.reserved.set(ware, (flag.reserved.get(ware) ?? 0) + amount);
  return true;
};

const depositReserved = (flag, ware, amount = 1) => {
  const reserved = flag.reserved.get(ware) ?? 0;
  if (reserved > 0) flag.reserved.set(ware, reserved - amount);
  else if (!canDeposit(flag, ware, amount)) return false;
  flag.stock.set(ware, (flag.stock.get(ware) ?? 0) + amount);
  return true;
};

const withdraw = (flag, ware, amount = 1) => {
  const current = flag.stock.get(ware) ?? 0;
  if (current < amount) return false;
  if (current === amount) flag.stock.delete(ware);
  else flag.stock.set(ware, current - amount);
  return true;
};

const pushEvent = (state, type, message) => {
  state.events.push({ time: round(state.time, 1), type, message });
  if (state.events.length > 240) state.events.splice(0, state.events.length - 240);
};

const updateFlagEvents = (state, flag) => {
  const total = sumValues(flag.stock);
  const full = total >= flag.totalCapacity;
  const empty = total === 0;
  if (full !== flag.full) {
    flag.full = full;
    if (full) pushEvent(state, "full", `Flag ${state.buildings.get(flag.uid)?.name ?? flag.uid} is full`);
  }
  if (empty !== flag.empty) {
    flag.empty = empty;
    if (empty) pushEvent(state, "empty", `Flag ${state.buildings.get(flag.uid)?.name ?? flag.uid} is empty`);
  }
};

const buildingCenter = building => ({ x: building.x, z: building.z });

const createBuilding = (data, options, uid = data.uid) => {
  const building = {
    uid,
    typeId: data.typeId,
    name: data.name,
    x: data.x,
    z: data.z,
    width: data.width ?? data.footprint?.[0] ?? 4,
    depth: data.depth ?? data.footprint?.[1] ?? 4,
    rotation: data.rotation ?? 0,
    access: { x: data.access?.x ?? data.x, z: data.access?.z ?? data.z },
    role: data.role ?? "idle",
    inputs: [...(data.inputs ?? [])],
    outputs: [...(data.outputs ?? [])],
    seconds: data.seconds ?? 10,
    alternativeFood: data.alternativeFood ?? false,
    demand: [],
    consumeSeconds: 30,
    routeId: null,
    internal: {
      inputs: new Map(),
      outputs: new Map(),
      progress: 0,
      outputIndex: 0
    },
    worker: {
      x: data.x,
      z: data.z,
      at: "building",
      state: "idle",
      mode: null,
      carrying: null,
      target: { x: data.x, z: data.z },
      start: { x: data.x, z: data.z },
      travel: 0,
      tripLength: 0
    }
  };
  building.demand = demandFor(building);
  building.consumeSeconds = consumeSecondsFor(building);
  building.consumeTimer = building.demand.length ? 3 + (uid % 5) : 0;
  building.demandIndex = uid % Math.max(1, building.demand.length);
  building.inputCapacity = 6;
  building.outputCapacity = 6;
  return building;
};

const createCarrier = (state, route, startDelay = 0) => {
  const leg = route.legs[0];
  const legStartedAt = state.time + startDelay;
  const carrier = {
    id: state.nextCarrierId++,
    routeId: route.id,
    legIndex: 0,
    path: leg.points,
    cumulative: leg.cumulative,
    pathLength: leg.length,
    distance: 0,
    legStartedAt,
    legEndsAt: legStartedAt + leg.length / state.options.carrierSpeed,
    movingStartedAt: startDelay > 0 ? legStartedAt : state.time,
    x: leg.points[0].x,
    z: leg.points[0].z,
    state: startDelay > 0 ? "waiting" : "travel",
    startDelay,
    taskGeneration: 1,
    serviceTimer: 0,
    servicePhase: "unload",
    serviceUnits: 0,
    transferAnim: 0,
    skipNext: false,
    cargo: [],
    wait: 0,
    moving: 0,
    service: 0,
    delivered: 0,
    dock: false,
    waitingAt: startDelay > 0 ? state.hubUid : null
  };
  state.carriers.push(carrier);
  state.carrierById.set(carrier.id, carrier);
  setSkipDecision(state, carrier);
  return carrier;
};

/** Road path plus the short off-road dock moves to/from each flag bay. */
const routePath = (state, fromUid, toUid) => {
  const from = state.buildings.get(fromUid), to = state.buildings.get(toUid);
  const road = state.graph.shortestPath(from.access, to.access);
  if (!road) return null;
  const points = [];
  const fromFlag = state.flags.get(fromUid), toFlag = state.flags.get(toUid);
  if (fromFlag && Math.hypot(fromFlag.x - road[0].x, fromFlag.z - road[0].z) > 1e-6)
    points.push({ x: fromFlag.x, z: fromFlag.z });
  points.push(...road);
  if (toFlag && Math.hypot(toFlag.x - road.at(-1).x, toFlag.z - road.at(-1).z) > 1e-6)
    points.push({ x: toFlag.x, z: toFlag.z });
  return points;
};

const buildRoutes = state => {
  const hub = state.buildings.get(state.hubUid);
  const points = [...state.buildings.values()].filter(building => building.uid !== hub.uid);
  const clusters = clusterPoints(points, state.options.routeCount, hub);
  const routes = [];
  let routeId = 0;
  for (const cluster of clusters) {
    const ordered = orderCluster(hub, cluster);
    const stops = [hub.uid];
    const legs = [];
    for (const building of ordered) {
      const previous = state.buildings.get(stops[stops.length - 1]);
      const path = routePath(state, previous.uid, building.uid);
      if (!path) {
        state.warnings.push(`No road path to ${building.name} (${building.uid})`);
        continue;
      }
      stops.push(building.uid);
      legs.push({
        from: previous.uid,
        to: building.uid,
        points: path,
        cumulative: cumulative(path),
        length: cumulative(path).at(-1)
      });
    }
    if (stops.length === 1) continue;
    const last = state.buildings.get(stops[stops.length - 1]);
    const homePath = routePath(state, last.uid, hub.uid);
    if (!homePath) continue;
    stops.push(hub.uid);
    legs.push({
      from: last.uid,
      to: hub.uid,
      points: homePath,
      cumulative: cumulative(homePath),
      length: cumulative(homePath).at(-1)
    });
    const route = { id: routeId++, stops, legs, color: routePalette[routes.length % routePalette.length], carriers: [] };
    routes.push(route);
  }
  state.routes = routes;
  for (const building of state.buildings.values()) building.routeId = null;
  for (const route of routes)
    for (const uid of route.stops) {
      const building = state.buildings.get(uid);
      if (building) building.routeId = route.id;
    }
  return routes;
};

const rebuildCarriers = state => {
  state.carriers = [];
  state.carrierById.clear();
  state.nextCarrierId = 1;
  state.eventQueue.length = 0;
  state.eventSeq = 0;
  state.docks.active.clear();
  state.docks.queue.length = 0;
  for (const route of state.routes) {
    const carrier = createCarrier(state, route, 0);
    route.carriers = [carrier.id];
    if (state.options.eventCarriers)
      scheduleEvent(state, carrier.legEndsAt, "arrive", carrier);
  }
  for (const flag of state.flags.values()) {
    flag.reserved.clear();
    flag.bay = null;
    flag.queue.length = 0;
  }
};

export const createSimulation = (island, overrides = {}) => {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const graph = new RoadGraph(island.roads);
  const state = {
    island,
    options,
    graph,
    time: 0,
    buildings: new Map(),
    flags: new Map(),
    routes: [],
    carriers: [],
    carrierById: new Map(),
    nextCarrierId: 1,
    nextBuildingUid: island.buildings.reduce((max, building) => Math.max(max, building.uid), 0) + 1,
    hubUid: island.buildings.find(building => building.typeId === HQ_TYPE)?.uid ?? island.buildings[0]?.uid,
    docks: { capacity: options.hubDocks, active: new Set(), queue: [] },
    warnings: [],
    events: [],
    eventQueue: [],
    eventSeq: 0,
    stats: {
      produced: new Map(),
      consumed: new Map(),
      used: new Map(),
      sunk: new Map(),
      delivered: 0,
      loaded: 0,
      services: 0,
      skippedStops: 0,
      producedTotal: 0,
      consumedTotal: 0,
      usedTotal: 0,
      sunkTotal: 0,
      carrierMovingSeconds: 0,
      carrierWaitSeconds: 0,
      carrierServiceSeconds: 0,
      carrierSamples: 0,
      cartLoadSamples: 0,
      cartSamples: 0,
      flagSamples: 0,
      flagFullSamples: 0,
      flagEmptySamples: 0,
      dockWaitSeconds: 0,
      initial: new Map()
    }
  };
  for (const data of island.buildings) {
    const building = createBuilding(data, options);
    state.buildings.set(building.uid, building);
    const flag = createFlag(building, options, state.buildings.values(), island.roads);
    state.flags.set(building.uid, flag);
    if (building.uid === state.hubUid && data.inventory) {
      for (const [ware, amount] of Object.entries(data.inventory)) {
        const count = Math.min(Number(amount) || 0, options.hubWareCapacity);
        if (count > 0) flag.stock.set(ware, count);
      }
    }
    state.stats.initial.set(building.uid, mapCopy(flag.stock));
  }
  state.hubUid = state.hubUid ?? [...state.buildings.keys()][0];
  buildRoutes(state);
  rebuildCarriers(state);
  state.statsInitial = new Map();
  for (const [uid, stock] of state.stats.initial) state.statsInitial.set(uid, new Map(stock));
  return state;
};

const addToMap = (map, ware, amount = 1) => map.set(ware, (map.get(ware) ?? 0) + amount);
const removeFromMap = (map, ware, amount = 1) => {
  const current = map.get(ware) ?? 0;
  if (current <= amount) map.delete(ware);
  else map.set(ware, current - amount);
};

const hasInputs = building => {
  if (!building.inputs.length) return true;
  if (building.alternativeFood) return building.inputs.some(ware => (building.internal.inputs.get(ware) ?? 0) > 0);
  return building.inputs.every(ware => (building.internal.inputs.get(ware) ?? 0) > 0);
};

const consumeInputs = (state, building) => {
  if (building.alternativeFood) {
    const ware = building.inputs.find(candidate => (building.internal.inputs.get(candidate) ?? 0) > 0);
    if (ware) {
      removeFromMap(building.internal.inputs, ware);
      state.stats.used.set(ware, (state.stats.used.get(ware) ?? 0) + 1);
      state.stats.usedTotal++;
    }
    return;
  }
  for (const ware of building.inputs) {
    removeFromMap(building.internal.inputs, ware);
    state.stats.used.set(ware, (state.stats.used.get(ware) ?? 0) + 1);
    state.stats.usedTotal++;
  }
};

const neededInput = (state, building) => {
  const flag = state.flags.get(building.uid);
  const wares = [...new Set([...building.inputs, ...building.demand])];
  for (const ware of wares) {
    const current = building.internal.inputs.get(ware) ?? 0;
    if (current >= state.options.targetInputStock) continue;
    if ((flag.stock.get(ware) ?? 0) > 0) return ware;
  }
  if (building.alternativeFood) {
    for (const ware of building.inputs) {
      if ((building.internal.inputs.get(ware) ?? 0) < state.options.targetInputStock &&
        (flag.stock.get(ware) ?? 0) > 0) return ware;
    }
  }
  return null;
};

const availableOutput = (state, building) => {
  const flag = state.flags.get(building.uid);
  for (const ware of building.outputs) {
    if ((building.internal.outputs.get(ware) ?? 0) <= 0) continue;
    if (canDeposit(flag, ware, 1)) return ware;
  }
  return null;
};

const startWorkerTrip = (worker, target, mode, carrying = null) => {
  worker.start = { x: worker.x, z: worker.z };
  worker.target = { x: target.x, z: target.z };
  worker.tripLength = distance(worker.start, worker.target);
  worker.travel = 0;
  worker.state = "moving";
  worker.mode = mode;
  worker.carrying = carrying;
};

const workerAtBuilding = (state, building) => {
  const worker = building.worker, flag = state.flags.get(building.uid);
  const output = availableOutput(state, building);
  if (output) {
    removeFromMap(building.internal.outputs, output);
    startWorkerTrip(worker, flag, "outputToFlag", output);
    return;
  }
  const input = neededInput(state, building);
  if (input) {
    startWorkerTrip(worker, flag, "fetchInput", null);
  }
};

const workerAtFlag = (state, building) => {
  const worker = building.worker, flag = state.flags.get(building.uid);
  if (worker.carrying) {
    if (!depositReserved(flag, worker.carrying)) return;
    worker.carrying = null;
  }
  const input = neededInput(state, building);
  if (input && withdraw(flag, input)) {
    startWorkerTrip(worker, buildingCenter(building), "inputToBuilding", input);
    return;
  }
  startWorkerTrip(worker, buildingCenter(building), "returnToBuilding", null);
};

const updateWorker = (state, building, dt) => {
  const worker = building.worker;
  if (worker.state === "moving") {
    worker.travel += state.options.workerSpeed * dt;
    if (worker.travel >= worker.tripLength) {
      worker.x = worker.target.x;
      worker.z = worker.target.z;
      worker.state = "idle";
      if (worker.mode === "outputToFlag") {
        worker.at = "flag";
        workerAtFlag(state, building);
      } else if (worker.mode === "inputToBuilding") {
        worker.at = "building";
        if (worker.carrying) addToMap(building.internal.inputs, worker.carrying);
        worker.carrying = null;
        workerAtBuilding(state, building);
      } else if (worker.mode === "fetchInput") {
        worker.at = "flag";
        workerAtFlag(state, building);
      } else {
        worker.at = "building";
        workerAtBuilding(state, building);
      }
    } else {
      const amount = worker.tripLength ? worker.travel / worker.tripLength : 1;
      worker.x = worker.start.x + (worker.target.x - worker.start.x) * amount;
      worker.z = worker.start.z + (worker.target.z - worker.start.z) * amount;
    }
    return;
  }
  if (worker.at === "flag") workerAtFlag(state, building);
  else workerAtBuilding(state, building);
};

const updateBuilding = (state, building, dt) => {
  if (building.outputs.length && sumValues(building.internal.outputs) < building.outputCapacity) {
    if (hasInputs(building)) {
      building.internal.progress += dt * state.options.productionScale;
      if (building.internal.progress >= building.seconds) {
        consumeInputs(state, building);
        const ware = building.outputs[building.internal.outputIndex % building.outputs.length];
        building.internal.outputIndex++;
        addToMap(building.internal.outputs, ware);
        state.stats.produced.set(ware, (state.stats.produced.get(ware) ?? 0) + 1);
        state.stats.producedTotal++;
        building.internal.progress = 0;
      }
    }
  }
  if (building.demand.length) {
    building.consumeTimer -= dt;
    if (building.consumeTimer <= 0) {
      const ware = building.demand[building.demandIndex % building.demand.length];
      if ((building.internal.inputs.get(ware) ?? 0) > 0) {
        removeFromMap(building.internal.inputs, ware);
        state.stats.consumed.set(ware, (state.stats.consumed.get(ware) ?? 0) + 1);
        state.stats.consumedTotal++;
        building.demandIndex++;
        building.consumeTimer = building.consumeSeconds;
      } else {
        building.consumeTimer = 1;
      }
    }
  }
  updateWorker(state, building, dt);
};

const routeNeeds = (state, route) => {
  const needs = [];
  for (const uid of route.stops) {
    if (uid === state.hubUid) continue;
    const building = state.buildings.get(uid);
    const flag = state.flags.get(uid);
    if (building.alternativeFood) {
      const current = building.inputs.reduce((sum, ware) =>
        sum + (building.internal.inputs.get(ware) ?? 0) + (flag.stock.get(ware) ?? 0) +
        (flag.reserved.get(ware) ?? 0), 0);
      if (current < state.options.targetInputStock)
        needs.push({ uid, ware: building.inputs[0], alternativeFood: true,
          amount: state.options.targetInputStock - current, priority: state.options.targetInputStock - current });
      continue;
    }
    const wares = [...new Set([...building.inputs, ...building.demand])];
    for (const ware of wares) {
      const current = (building.internal.inputs.get(ware) ?? 0) +
        (flag.stock.get(ware) ?? 0) + (flag.reserved.get(ware) ?? 0);
      if (current >= state.options.targetInputStock) continue;
      needs.push({ uid, ware, amount: state.options.targetInputStock - current, priority: state.options.targetInputStock - current });
    }
  }
  return needs.sort((first, second) => second.priority - first.priority ||
    first.uid - second.uid || first.ware.localeCompare(second.ware));
};

/** One unit at a time: a manual transfer is a timed state, not an instant mutation. */
const unloadOne = (state, carrier, uid) => {
  const index = carrier.cargo.findIndex(unit => unit.to === uid);
  if (index < 0) return false;
  const unit = carrier.cargo[index];
  const flag = state.flags.get(uid);
  if (!depositReserved(flag, unit.ware)) return false;
  carrier.cargo.splice(index, 1);
  carrier.lastTransfer = { kind: "unload", ware: unit.ware };
  carrier.transferAnim = state.options.transferAnimationSeconds;
  carrier.delivered++;
  state.stats.delivered++;
  return true;
};

/** One export unit from a producer flag; the destination capacity is reserved first. */
const loadExportOne = (state, carrier, uid) => {
  if (carrier.cargo.length >= state.options.cartCapacity) return false;
  const building = state.buildings.get(uid);
  const flag = state.flags.get(uid);
  const hub = state.flags.get(state.hubUid);
  for (const ware of building.outputs) {
    if (building.inputs.includes(ware)) continue;
    if ((flag.stock.get(ware) ?? 0) <= 0) continue;
    if (!reserve(hub, ware, 1)) continue;
    if (!withdraw(flag, ware)) {
      hub.reserved.set(ware, (hub.reserved.get(ware) ?? 0) - 1);
      continue;
    }
    carrier.cargo.push({ ware, to: state.hubUid });
    carrier.lastTransfer = { kind: "load", ware };
    carrier.transferAnim = state.options.transferAnimationSeconds;
    state.stats.loaded++;
    return true;
  }
  return false;
};

/** One input/demand unit from the hub; still leaves room for exports along the route. */
const loadRouteOne = (state, carrier, route) => {
  const hub = state.flags.get(state.hubUid);
  const inputLimit = Math.max(1, state.options.cartCapacity - 2);
  if (carrier.cargo.length >= inputLimit) return false;
  for (const need of routeNeeds(state, route)) {
    const building = state.buildings.get(need.uid);
    const ware = need.alternativeFood
      ? building.inputs.find(candidate => (hub.stock.get(candidate) ?? 0) > 0)
      : need.ware;
    if (!ware || (hub.stock.get(ware) ?? 0) <= 0) continue;
    if (!reserve(state.flags.get(need.uid), ware, 1)) continue;
    if (!withdraw(hub, ware)) {
      const flag = state.flags.get(need.uid);
      flag.reserved.set(ware, (flag.reserved.get(ware) ?? 0) - 1);
      continue;
    }
    carrier.cargo.push({ ware, to: need.uid });
    carrier.lastTransfer = { kind: "load", ware };
    carrier.transferAnim = state.options.transferAnimationSeconds;
    state.stats.loaded++;
    return true;
  }
  return false;
};

const serviceTick = (state, carrier, uid) => {
  if (carrier.servicePhase === "unload") {
    if (unloadOne(state, carrier, uid)) return true;
    carrier.servicePhase = "load";
  }
  const route = state.routes[carrier.routeId];
  return uid === state.hubUid ? loadRouteOne(state, carrier, route) : loadExportOne(state, carrier, uid);
};

const serviceAtStop = (state, carrier, uid) => {
  state.stats.services++;
  carrier.state = "service";
  carrier.servicePhase = "unload";
  carrier.serviceTimer = state.options.serviceSetupSeconds;
  carrier.serviceUnits = 0;
  carrier.serviceStop = uid;
  carrier.transferAnim = 0;
  carrier.lastTransfer = undefined;
};

/** Conservative lookahead: stock plus output already in the building plus cycles that can finish by arrival. */
const expectedStopGoods = (state, uid, eta) => {
  const building = state.buildings.get(uid);
  if (!building) return 0;
  const flag = state.flags.get(uid);
  let expected = sumValues(flag.stock) + sumValues(building.internal.outputs);
  if (building.outputs.length && building.seconds > 0 && hasInputs(building))
    expected += Math.floor((building.internal.progress + eta) / building.seconds);
  return expected;
};

const setSkipDecision = (state, carrier) => {
  carrier.skipNext = false;
  if (!state.options.smartSkip) return;
  const route = state.routes[carrier.routeId];
  const nextUid = route.stops[carrier.legIndex + 1];
  if (nextUid === undefined || nextUid === state.hubUid) return;
  if (carrier.cargo.some(unit => unit.to === nextUid)) return;
  const eta = route.legs[carrier.legIndex].length / state.options.carrierSpeed;
  carrier.skipNext = expectedStopGoods(state, nextUid, eta) === 0;
};

const advanceLeg = (state, carrier) => {
  const route = state.routes[carrier.routeId];
  carrier.legIndex++;
  if (carrier.legIndex >= route.legs.length) carrier.legIndex = 0;
  const leg = route.legs[carrier.legIndex];
  carrier.path = leg.points;
  carrier.cumulative = leg.cumulative;
  carrier.pathLength = leg.length;
  carrier.distance = 0;
  carrier.x = leg.points[0].x;
  carrier.z = leg.points[0].z;
  carrier.state = "travel";
  carrier.waitingAt = null;
  setSkipDecision(state, carrier);
};

const arriveAtStop = (state, carrier) => {
  const route = state.routes[carrier.routeId];
  const uid = route.stops[carrier.legIndex + 1];
  if (carrier.skipNext && uid !== state.hubUid) {
    carrier.skipNext = false;
    state.stats.skippedStops++;
    advanceLeg(state, carrier);
    return;
  }
  if (uid === state.hubUid) {
    if (state.docks.active.size < state.docks.capacity) {
      state.docks.active.add(carrier.id);
      carrier.dock = true;
      serviceAtStop(state, carrier, uid);
    } else {
      carrier.state = "waiting";
      carrier.waitingAt = uid;
      state.docks.queue.push(carrier.id);
      state.stats.dockWaitSeconds += 0;
    }
    return;
  }
  const flag = state.flags.get(uid);
  if (flag.bay !== null && flag.bay !== carrier.id) {
    carrier.state = "waiting";
    carrier.waitingAt = uid;
    flag.queue.push(carrier.id);
    return;
  }
  flag.bay = carrier.id;
  serviceAtStop(state, carrier, uid);
};

const departStop = (state, carrier) => {
  const route = state.routes[carrier.routeId];
  const uid = route.stops[carrier.legIndex + 1];
  if (uid === state.hubUid) {
    state.docks.active.delete(carrier.id);
    carrier.dock = false;
    const nextId = state.docks.queue.shift();
    if (nextId !== undefined) {
      const next = state.carrierById.get(nextId);
      if (next) {
        state.docks.active.add(next.id);
        next.dock = true;
        serviceAtStop(state, next, state.hubUid);
      }
    }
  } else {
    const flag = state.flags.get(uid);
    if (flag.bay === carrier.id) flag.bay = null;
    const nextId = flag.queue.shift();
    if (nextId !== undefined) {
      const next = state.carrierById.get(nextId);
      if (next) {
        flag.bay = next.id;
        serviceAtStop(state, next, uid);
      }
    }
  }
  advanceLeg(state, carrier);
};

const tryAdmit = (state, carrier) => {
  if (carrier.waitingAt === state.hubUid) {
    if (state.docks.active.size >= state.docks.capacity) return;
    state.docks.queue = state.docks.queue.filter(id => id !== carrier.id);
    state.docks.active.add(carrier.id);
    carrier.dock = true;
    serviceAtStop(state, carrier, state.hubUid);
    return;
  }
  const flag = state.flags.get(carrier.waitingAt);
  if (!flag || (flag.bay !== null && flag.bay !== carrier.id)) return;
  flag.queue = flag.queue.filter(id => id !== carrier.id);
  flag.bay = carrier.id;
  serviceAtStop(state, carrier, carrier.waitingAt);
};

/* ---------------------------------------------------------------------------
 * Event-driven carrier lane
 *
 * The carrier's movement and service are scheduled at exact simulation times.
 * The renderer may sample positions every frame, but no per-tick carrier logic
 * is required. The event queue is a binary heap; pending entries are exported so
 * a resumed run can reproduce the same next milestone.
 * ------------------------------------------------------------------------- */

const eventBefore = (first, second) =>
  first.at < second.at - 1e-9 ||
  (Math.abs(first.at - second.at) <= 1e-9 && first.seq < second.seq);

const pushEventQueue = (state, event) => {
  const queue = state.eventQueue;
  queue.push(event);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (!eventBefore(queue[index], queue[parent])) break;
    [queue[index], queue[parent]] = [queue[parent], queue[index]];
    index = parent;
  }
};

const popEventQueue = state => {
  const queue = state.eventQueue;
  if (!queue.length) return undefined;
  const first = queue[0];
  const last = queue.pop();
  if (queue.length && last) {
    queue[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1, right = left + 1;
      let smallest = index;
      if (left < queue.length && eventBefore(queue[left], queue[smallest])) smallest = left;
      if (right < queue.length && eventBefore(queue[right], queue[smallest])) smallest = right;
      if (smallest === index) break;
      [queue[index], queue[smallest]] = [queue[smallest], queue[index]];
      index = smallest;
    }
  }
  return first;
};

const sortedEvents = state => [...state.eventQueue].sort((first, second) =>
  first.at - second.at || first.seq - second.seq);

const scheduleEvent = (state, at, kind, carrier) => {
  pushEventQueue(state, {
    at,
    seq: state.eventSeq++,
    kind,
    carrierId: carrier.id,
    generation: carrier.taskGeneration ?? 0
  });
};

const startServiceEvent = (state, carrier, uid) => {
  state.stats.services++;
  carrier.taskGeneration = (carrier.taskGeneration ?? 0) + 1;
  carrier.startDelay = 0;
  carrier.state = "service";
  carrier.servicePhase = "unload";
  carrier.serviceTimer = state.options.serviceSetupSeconds;
  carrier.serviceUnits = 0;
  carrier.serviceStop = uid;
  carrier.transferAnim = 0;
  carrier.lastTransfer = undefined;
  const flag = state.flags.get(uid);
  if (flag) {
    carrier.x = flag.x;
    carrier.z = flag.z;
  }
  scheduleEvent(state, state.time + state.options.serviceSetupSeconds, "transfer", carrier);
};

const startTravelEvent = (state, carrier) => {
  if (carrier.state !== "waiting" || carrier.startDelay <= 0) return;
  carrier.startDelay = 0;
  carrier.state = "travel";
  carrier.waitingAt = null;
  carrier.legStartedAt = state.time;
  carrier.movingStartedAt = state.time;
  carrier.x = carrier.path[0].x;
  carrier.z = carrier.path[0].z;
  scheduleEvent(state, carrier.legEndsAt, "arrive", carrier);
};

const admitNextEvent = (state, uid) => {
  if (uid === state.hubUid) {
    if (state.docks.active.size >= state.docks.capacity) return;
    const nextId = state.docks.queue.shift();
    if (nextId === undefined) return;
    const next = state.carrierById.get(nextId);
    if (!next) return;
    state.docks.active.add(next.id);
    next.dock = true;
    startServiceEvent(state, next, uid);
    return;
  }
  const flag = state.flags.get(uid);
  if (!flag || flag.bay !== null) return;
  const nextId = flag.queue.shift();
  if (nextId === undefined) return;
  const next = state.carrierById.get(nextId);
  if (!next) return;
  flag.bay = next.id;
  startServiceEvent(state, next, uid);
};

const releaseEventStop = (state, carrier, uid) => {
  if (uid === state.hubUid) {
    state.docks.active.delete(carrier.id);
    carrier.dock = false;
  } else {
    const flag = state.flags.get(uid);
    if (flag && flag.bay === carrier.id) flag.bay = null;
  }
  admitNextEvent(state, uid);
};

const advanceLegEvent = (state, carrier) => {
  const route = state.routes[carrier.routeId];
  carrier.legIndex++;
  if (carrier.legIndex >= route.legs.length) carrier.legIndex = 0;
  const leg = route.legs[carrier.legIndex];
  carrier.path = leg.points;
  carrier.cumulative = leg.cumulative;
  carrier.pathLength = leg.length;
  carrier.distance = 0;
  carrier.taskGeneration = (carrier.taskGeneration ?? 0) + 1;
  carrier.legStartedAt = state.time;
  carrier.legEndsAt = state.time + leg.length / state.options.carrierSpeed;
  carrier.movingStartedAt = state.time;
  carrier.x = leg.points[0].x;
  carrier.z = leg.points[0].z;
  carrier.state = "travel";
  carrier.waitingAt = null;
  setSkipDecision(state, carrier);
  scheduleEvent(state, carrier.legEndsAt, "arrive", carrier);
};

const arriveEvent = (state, carrier) => {
  if (carrier.state !== "travel") return;
  const route = state.routes[carrier.routeId];
  const uid = route.stops[carrier.legIndex + 1];
  carrier.distance = carrier.pathLength;
  const end = carrier.path[carrier.path.length - 1];
  carrier.x = end.x;
  carrier.z = end.z;
  if (carrier.movingStartedAt !== undefined) {
    state.stats.carrierMovingSeconds += Math.max(0, state.time - carrier.movingStartedAt);
    carrier.movingStartedAt = undefined;
  }
  if (carrier.skipNext && uid !== state.hubUid) {
    carrier.skipNext = false;
    state.stats.skippedStops++;
    advanceLegEvent(state, carrier);
    return;
  }
  if (uid === state.hubUid) {
    if (state.docks.active.size < state.docks.capacity) {
      state.docks.active.add(carrier.id);
      carrier.dock = true;
      startServiceEvent(state, carrier, uid);
    } else {
      carrier.state = "waiting";
      carrier.waitingAt = uid;
      state.docks.queue.push(carrier.id);
    }
    return;
  }
  const flag = state.flags.get(uid);
  if (flag.bay !== null && flag.bay !== carrier.id) {
    carrier.state = "waiting";
    carrier.waitingAt = uid;
    flag.queue.push(carrier.id);
    return;
  }
  flag.bay = carrier.id;
  startServiceEvent(state, carrier, uid);
};

const departEvent = (state, carrier) => {
  const route = state.routes[carrier.routeId];
  const uid = route.stops[carrier.legIndex + 1];
  releaseEventStop(state, carrier, uid);
  advanceLegEvent(state, carrier);
};

const transferEvent = (state, carrier) => {
  if (carrier.state !== "service") return;
  const route = state.routes[carrier.routeId];
  const uid = carrier.serviceStop ?? route.stops[carrier.legIndex + 1];
  if (serviceTick(state, carrier, uid)) {
    carrier.serviceTimer = state.options.transferSeconds;
    scheduleEvent(state, state.time + state.options.transferSeconds, "transfer", carrier);
  } else {
    departEvent(state, carrier);
  }
};

const processCarrierEvents = (state, target) => {
  while (state.eventQueue.length && state.eventQueue[0].at <= target + 1e-9) {
    const event = popEventQueue(state);
    if (!event) break;
    if (event.at > state.time) state.time = event.at;
    const carrier = state.carrierById.get(event.carrierId);
    if (!carrier) continue;
    if (event.generation !== (carrier.taskGeneration ?? 0)) continue;
    if (event.kind === "start") startTravelEvent(state, carrier);
    else if (event.kind === "arrive") arriveEvent(state, carrier);
    else if (event.kind === "transfer") transferEvent(state, carrier);
  }
};

const syncCarrierPositions = (state, dt) => {
  for (const carrier of state.carriers) {
    if (carrier.state === "travel" && carrier.legEndsAt > carrier.legStartedAt) {
      const progress = Math.max(0, Math.min(1,
        (state.time - carrier.legStartedAt) / (carrier.legEndsAt - carrier.legStartedAt)));
      carrier.distance = carrier.pathLength * progress;
      const point = pointAt(carrier.path, carrier.cumulative, carrier.distance);
      carrier.x = point.x;
      carrier.z = point.z;
    } else if (carrier.state === "waiting") {
      carrier.wait += dt;
      state.stats.carrierWaitSeconds += dt;
    }
    carrier.transferAnim = Math.max(0, carrier.transferAnim - dt);
  }
};

const updateCarrier = (state, carrier, dt) => {
  if (carrier.startDelay > 0) {
    carrier.startDelay -= dt;
    if (carrier.startDelay <= 0) {
      carrier.startDelay = 0;
      carrier.state = "travel";
      carrier.waitingAt = null;
    }
    return;
  }
  if (carrier.state === "travel") {
    carrier.moving += dt;
    state.stats.carrierMovingSeconds += dt;
    carrier.distance += state.options.carrierSpeed * dt;
    if (carrier.distance >= carrier.pathLength) {
      carrier.distance = carrier.pathLength;
      const last = carrier.path[carrier.path.length - 1];
      carrier.x = last.x;
      carrier.z = last.z;
      arriveAtStop(state, carrier);
    } else {
      const point = pointAt(carrier.path, carrier.cumulative, carrier.distance);
      carrier.x = point.x;
      carrier.z = point.z;
    }
  } else if (carrier.state === "service") {
    carrier.service += dt;
    state.stats.carrierServiceSeconds += dt;
    carrier.transferAnim = Math.max(0, carrier.transferAnim - dt);
    carrier.serviceTimer -= dt;
    if (carrier.serviceTimer <= 0) {
      const route = state.routes[carrier.routeId];
      const uid = carrier.serviceStop ?? route.stops[carrier.legIndex + 1];
      if (serviceTick(state, carrier, uid)) {
        carrier.serviceTimer = state.options.transferSeconds;
        carrier.serviceUnits++;
      } else departStop(state, carrier);
    }
  } else {
    carrier.wait += dt;
    state.stats.carrierWaitSeconds += dt;
    if (carrier.waitingAt === state.hubUid) state.stats.dockWaitSeconds += dt;
    tryAdmit(state, carrier);
  }
};

const updateStats = state => {
  state.stats.carrierSamples++;
  let full = 0, empty = 0;
  for (const flag of state.flags.values()) {
    updateFlagEvents(state, flag);
    if (flag.full) full++;
    if (flag.empty) empty++;
    if (flag.full) flag.fullSeconds += 1;
    if (flag.empty) flag.emptySeconds += 1;
  }
  state.stats.flagSamples++;
  state.stats.flagFullSamples += full;
  state.stats.flagEmptySamples += empty;
  for (const carrier of state.carriers) {
    if (carrier.state === "travel") {
      state.stats.cartLoadSamples += carrier.cargo.length / state.options.cartCapacity;
      state.stats.cartSamples++;
    }
  }
  state.surplusTimer = (state.surplusTimer ?? 0) + 1;
  if (state.surplusTimer >= state.options.surplusSinkSeconds) {
    state.surplusTimer = 0;
    const demanded = new Set();
    for (const building of state.buildings.values()) {
      for (const ware of building.inputs) demanded.add(ware);
      for (const ware of building.demand) demanded.add(ware);
    }
    const hub = state.flags.get(state.hubUid);
    for (const [ware, amount] of hub.stock) {
      if (demanded.has(ware) || amount <= state.options.surplusThreshold) continue;
      withdraw(hub, ware);
      state.stats.sunk.set(ware, (state.stats.sunk.get(ware) ?? 0) + 1);
      state.stats.sunkTotal++;
    }
  }
};

/** Advance the whole world by `dt` simulated seconds. */
export const step = (state, dt) => {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const target = state.time + dt;
  if (state.options.eventCarriers) {
    processCarrierEvents(state, target);
    state.time = target;
    for (const building of state.buildings.values()) updateBuilding(state, building, dt);
    syncCarrierPositions(state, dt);
  } else {
    state.time = target;
    for (const building of state.buildings.values()) updateBuilding(state, building, dt);
    for (const carrier of state.carriers) updateCarrier(state, carrier, dt);
  }
  updateStats(state);
};

export const stepMany = (state, seconds, dt = 0.1) => {
  const count = Math.max(0, Math.round(seconds / dt));
  for (let index = 0; index < count; index++) step(state, dt);
  return state;
};

export const routeSummary = state => state.routes.map(route => ({
  id: route.id,
  color: route.color,
  stops: route.stops.map(uid => state.buildings.get(uid)?.name ?? uid),
  legLengths: route.legs.map(leg => round(leg.length, 1)),
  carriers: state.carriers.filter(carrier => carrier.routeId === route.id).map(carrier => carrier.id)
}));

export const totals = state => {
  const flagStock = new Map(), internalInputs = new Map(), internalOutputs = new Map(),
    workerCargo = new Map(), cargo = new Map();
  for (const flag of state.flags.values())
    for (const [ware, amount] of flag.stock) addToMap(flagStock, ware, amount);
  for (const building of state.buildings.values()) {
    for (const [ware, amount] of building.internal.inputs) addToMap(internalInputs, ware, amount);
    for (const [ware, amount] of building.internal.outputs) addToMap(internalOutputs, ware, amount);
    if (building.worker.carrying) addToMap(workerCargo, building.worker.carrying, 1);
  }
  for (const carrier of state.carriers)
    for (const unit of carrier.cargo) addToMap(cargo, unit.ware, 1);
  return { flagStock, internalInputs, internalOutputs, workerCargo, cargo };
};

export const checkConservation = state => {
  const { flagStock, internalInputs, internalOutputs, workerCargo, cargo } = totals(state);
  const wares = new Set([...flagStock.keys(), ...internalInputs.keys(), ...internalOutputs.keys(),
    ...workerCargo.keys(), ...cargo.keys(), ...state.stats.produced.keys(), ...state.stats.consumed.keys(),
    ...state.stats.used.keys(), ...state.stats.sunk.keys()]);
  const problems = [];
  for (const ware of [...wares].sort()) {
    let initial = 0;
    for (const stock of state.statsInitial.values()) initial += stock.get(ware) ?? 0;
    const produced = state.stats.produced.get(ware) ?? 0;
    const consumed = state.stats.consumed.get(ware) ?? 0;
    const used = state.stats.used.get(ware) ?? 0;
    const sunk = state.stats.sunk.get(ware) ?? 0;
    const stored = (flagStock.get(ware) ?? 0) + (internalInputs.get(ware) ?? 0) +
      (internalOutputs.get(ware) ?? 0) + (workerCargo.get(ware) ?? 0) + (cargo.get(ware) ?? 0);
    if (initial + produced !== consumed + used + sunk + stored) {
      problems.push({ ware, initial, produced, consumed, used, sunk, stored,
        expected: initial + produced, actual: consumed + used + sunk + stored });
    }
  }
  return { ok: problems.length === 0, problems };
};

export const stateHash = state => {
  const parts = [round(state.time, 3)];
  for (const building of [...state.buildings.values()].sort((a, b) => a.uid - b.uid)) {
    parts.push(building.uid, round(building.internal.progress, 3), building.internal.outputIndex,
      sortedEntries(building.internal.inputs), sortedEntries(building.internal.outputs),
      building.worker.at, building.worker.state, building.worker.mode, building.worker.carrying);
  }
  for (const flag of [...state.flags.values()].sort((a, b) => a.uid - b.uid))
    parts.push(flag.uid, sortedEntries(flag.stock), sortedEntries(flag.reserved), flag.bay,
      [...flag.queue]);
  for (const carrier of [...state.carriers].sort((a, b) => a.id - b.id))
    parts.push(carrier.id, carrier.routeId, carrier.legIndex, round(carrier.distance, 3),
      carrier.state, carrier.cargo.map(unit => `${unit.ware}->${unit.to}`).sort(),
      carrier.servicePhase, round(carrier.serviceTimer, 3), round(carrier.transferAnim, 3),
      carrier.serviceStop, carrier.skipNext, carrier.lastTransfer?.kind, carrier.lastTransfer?.ware,
      round(carrier.legStartedAt, 3), round(carrier.legEndsAt, 3),
      round(carrier.startDelay ?? 0, 3), carrier.taskGeneration ?? 0,
      carrier.waitingAt ?? null, carrier.dock ? 1 : 0);
  parts.push(state.eventSeq, state.nextCarrierId, [...state.docks.active].sort((a, b) => a - b),
    [...state.docks.queue]);
  parts.push(sortedEvents(state).map(event =>
    `${round(event.at, 3)}:${event.kind}:${event.carrierId}:${event.generation ?? 0}:${event.seq}`));
  return JSON.stringify(parts);
};

export const summary = state => ({
  time: round(state.time, 1),
  routes: state.routes.length,
  buildings: state.buildings.size,
  carriers: state.carriers.length,
  delivered: state.stats.delivered,
  produced: state.stats.producedTotal,
  consumed: state.stats.consumedTotal,
  used: state.stats.usedTotal,
  sunk: state.stats.sunkTotal,
  loaded: state.stats.loaded,
  services: state.stats.services,
  skippedStops: state.stats.skippedStops,
  cartUtilization: state.stats.cartSamples
    ? round(state.stats.cartLoadSamples / state.stats.cartSamples, 2) : 0,
  movingShare: state.stats.carrierMovingSeconds + state.stats.carrierWaitSeconds + state.stats.carrierServiceSeconds
    ? round(state.stats.carrierMovingSeconds /
      (state.stats.carrierMovingSeconds + state.stats.carrierWaitSeconds + state.stats.carrierServiceSeconds), 2) : 0,
  fullShare: state.stats.flagSamples ? round(state.stats.flagFullSamples / state.stats.flagSamples, 2) : 0,
  emptyShare: state.stats.flagSamples ? round(state.stats.flagEmptySamples / state.stats.flagSamples, 2) : 0,
  dockWaitSeconds: round(state.stats.dockWaitSeconds, 1),
  warnings: state.warnings
});

export const addBuilding = (state, { typeId, x, z }) => {
  const catalog = state.island.catalog.find(entry => entry.typeId === typeId);
  if (!catalog) throw new Error(`Unknown building type ${typeId}`);
  const access = state.graph.nearest(x, z);
  if (!access) throw new Error("The island has no road network");
  const uid = state.nextBuildingUid++;
  const data = {
    uid, typeId, name: catalog.name, x, z,
    width: catalog.footprint[0], depth: catalog.footprint[1], rotation: 0,
    access: { x: access.x, z: access.z }, role: catalog.role,
    inputs: catalog.inputs, outputs: catalog.outputs, seconds: catalog.seconds,
    alternativeFood: catalog.alternativeFood
  };
  const building = createBuilding(data, state.options, uid);
  state.buildings.set(uid, building);
  state.flags.set(uid, createFlag(building, state.options, state.buildings.values(), state.island.roads));
  state.warnings.push(`Added ${catalog.name} at ${round(x, 1)},${round(z, 1)} with flag ${round(access.x, 1)},${round(access.z, 1)}`);
  pushEvent(state, "build", `Added ${catalog.name} (${uid})`);
  buildRoutes(state);
  rebuildCarriers(state);
  return building;
};

export const removeBuilding = (state, uid) => {
  if (uid === state.hubUid) throw new Error("The headquarters cannot be removed");
  if (!state.buildings.has(uid)) return false;
  state.buildings.delete(uid);
  state.flags.delete(uid);
  buildRoutes(state);
  rebuildCarriers(state);
  pushEvent(state, "build", `Removed building ${uid}`);
  return true;
};

export const addCarrier = (state, routeId) => {
  const route = state.routes.find(candidate => candidate.id === routeId);
  if (!route) throw new Error(`Unknown route ${routeId}`);
  const count = state.carriers.filter(carrier => carrier.routeId === routeId).length;
  const carrier = createCarrier(state, route, 1 + count * 0.8);
  route.carriers.push(carrier.id);
  if (state.options.eventCarriers) {
    if (carrier.startDelay > 0) scheduleEvent(state, carrier.legStartedAt, "start", carrier);
    else scheduleEvent(state, carrier.legEndsAt, "arrive", carrier);
  }
  return carrier;
};

export const rebuildRoutes = state => {
  buildRoutes(state);
  rebuildCarriers(state);
  pushEvent(state, "route", `Rebuilt ${state.routes.length} routes`);
};

export const setOptions = (state, next) => {
  Object.assign(state.options, next);
  state.docks.capacity = state.options.hubDocks;
  for (const building of state.buildings.values()) {
    const flag = state.flags.get(building.uid);
    const capacity = flagCapacities(building, state.options);
    flag.totalCapacity = capacity.total;
    flag.wareCapacity = capacity.ware;
  }
};

const mapToObject = map => Object.fromEntries(sortedEntries(map));
const nestedMapToObject = map => Object.fromEntries([...map.entries()]
  .sort(([first], [second]) => first - second)
  .map(([key, value]) => [String(key), mapToObject(value)]));
const objectToMap = object => new Map(Object.entries(object ?? {})
  .map(([ware, amount]) => [ware, Number(amount)]));
const objectToNestedMap = object => new Map(Object.entries(object ?? {})
  .map(([uid, stock]) => [Number(uid), objectToMap(stock)]));

const exportStats = stats => ({
  produced: mapToObject(stats.produced),
  consumed: mapToObject(stats.consumed),
  used: mapToObject(stats.used),
  sunk: mapToObject(stats.sunk),
  initial: nestedMapToObject(stats.initial),
  delivered: stats.delivered,
  loaded: stats.loaded,
  services: stats.services,
  skippedStops: stats.skippedStops,
  producedTotal: stats.producedTotal,
  consumedTotal: stats.consumedTotal,
  usedTotal: stats.usedTotal,
  sunkTotal: stats.sunkTotal,
  carrierMovingSeconds: stats.carrierMovingSeconds,
  carrierWaitSeconds: stats.carrierWaitSeconds,
  carrierServiceSeconds: stats.carrierServiceSeconds,
  carrierSamples: stats.carrierSamples,
  cartLoadSamples: stats.cartLoadSamples,
  cartSamples: stats.cartSamples,
  flagSamples: stats.flagSamples,
  flagFullSamples: stats.flagFullSamples,
  flagEmptySamples: stats.flagEmptySamples,
  dockWaitSeconds: stats.dockWaitSeconds
});

const restoreStats = (state, stats) => {
  state.stats.produced = objectToMap(stats.produced);
  state.stats.consumed = objectToMap(stats.consumed);
  state.stats.used = objectToMap(stats.used);
  state.stats.sunk = objectToMap(stats.sunk);
  state.stats.initial = objectToNestedMap(stats.initial);
  for (const key of [
    "delivered", "loaded", "services", "skippedStops", "producedTotal", "consumedTotal",
    "usedTotal", "sunkTotal", "carrierMovingSeconds", "carrierWaitSeconds",
    "carrierServiceSeconds", "carrierSamples", "cartLoadSamples", "cartSamples",
    "flagSamples", "flagFullSamples", "flagEmptySamples", "dockWaitSeconds"
  ]) state.stats[key] = Number(stats[key] ?? 0);
  state.statsInitial = new Map([...state.stats.initial].map(([uid, stock]) =>
    [uid, new Map(stock)]));
};

export const exportState = state => ({
  time: round(state.time, 2),
  options: state.options,
  seed: state.island.seed,
  routes: routeSummary(state),
  summary: summary(state),
  flags: [...state.flags.values()].map(flag => ({
    uid: flag.uid, name: state.buildings.get(flag.uid)?.name,
    stock: Object.fromEntries(sortedEntries(flag.stock)),
    reserved: Object.fromEntries(sortedEntries(flag.reserved)),
    totalCapacity: flag.totalCapacity, wareCapacity: flag.wareCapacity,
    bay: flag.bay, queue: [...flag.queue]
  })),
  carriers: state.carriers.map(carrier => ({
    id: carrier.id, routeId: carrier.routeId, legIndex: carrier.legIndex,
    state: carrier.state, servicePhase: carrier.servicePhase,
    serviceTimer: round(carrier.serviceTimer, 3), serviceUnits: carrier.serviceUnits,
    transferAnim: round(carrier.transferAnim, 3), serviceStop: carrier.serviceStop,
    skipNext: carrier.skipNext,
    lastTransfer: carrier.lastTransfer ? { ...carrier.lastTransfer } : undefined,
    legStartedAt: round(carrier.legStartedAt, 3), legEndsAt: round(carrier.legEndsAt, 3),
    startDelay: round(carrier.startDelay ?? 0, 3), taskGeneration: carrier.taskGeneration ?? 0,
    movingStartedAt: carrier.movingStartedAt === undefined ? undefined : round(carrier.movingStartedAt, 3),
    waitingAt: carrier.waitingAt ?? null, dock: carrier.dock,
    cargo: carrier.cargo.map(unit => ({ ...unit })),
    x: round(carrier.x, 2), z: round(carrier.z, 2), delivered: carrier.delivered
  })),
  eventSeq: state.eventSeq,
  nextCarrierId: state.nextCarrierId,
  docks: {
    active: [...state.docks.active].sort((first, second) => first - second),
    queue: [...state.docks.queue]
  },
  eventQueue: sortedEvents(state).map(event => ({ ...event }))
});

export const flagTotals = state => [...state.flags.values()].map(flag => ({
  uid: flag.uid,
  name: state.buildings.get(flag.uid)?.name ?? String(flag.uid),
  total: sumValues(flag.stock),
  reserved: sumValues(flag.reserved),
  capacity: flag.totalCapacity,
  stock: Object.fromEntries(sortedEntries(flag.stock))
}));

export { distance, keyOf, pointAt, round };
