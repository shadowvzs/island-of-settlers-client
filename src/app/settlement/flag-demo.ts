// oxlint-disable no-explicit-any
// oxlint-disable max-lines
/**
 * Real-engine visual prototype of the route-bound flag logistics model.
 *
 * The normal settlement simulation still runs the island (terrain, buildings, real workers, animals).
 * This layer hides the normal carrier actors from the render frame, runs the dependency-free flag
 * simulation from `demos/route-logistics`, and adds its carriers/porters to the real renderer.
 * The real economy is deliberately untouched: this is a look-and-animation prototype, not a save
 * format or a gameplay replacement.
 */
import type { CameraState } from "../../render-common/camera-state";
import { cartLoadVariant } from "../../render-common/logistics/cart-cargo-heap";
import type { HandcartFrame } from "../../render-common/logistics/handcart-frame";
import { cartCentreBehind, HANDCART } from "../../render-common/logistics/handcart-rules";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { advanceGaitPhase, locomotionClipTime } from "../../render-common/workers/worker-gait";
import type { WorkerAppearance, WorkerFrame } from "../../render-common/workers/worker-unit";
import { turnYawToward } from "../../shared/settlement/settlement-geometry";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

const TAU = Math.PI * 2;

interface DemoActor {
  animationTime: number;
  cart: HandcartFrame | null;
  frame: WorkerFrame;
  gaitPhase: number;
  heading: number;
  lastX: number;
  lastZ: number;
  idle: number;
}

/** Stages the developed-island fixture for `?flagdemo=1`, stamped now to skip offline catch-up. */
export const loadFlagDemoStartup = async (
  saveStore: { writeStartupGame(json: string): Promise<void> },
  sessionClock: () => number,
  setStep: (text: string) => unknown
) => {
  await setStep("Loading the developed island for the logistics demo...");
  const fixture = await fetch(new URL("demo/continued-0.json", location.href)).then(response => {
    if (!response.ok) throw new Error(`Demo island not found (${response.status})`);
    return response.json();
  });
  fixture.savedAt = sessionClock();
  await saveStore.writeStartupGame(JSON.stringify(fixture));
};

export interface FlagDemoOptions {
  appearances: readonly WorkerAppearance[];
  camera: CameraState;
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  viewport: HTMLElement;
  world: WorldData;
}

interface SimBuilding {
  uid: number;
  x: number;
  z: number;
  access: { x: number; z: number };
  worker: {
    x: number;
    z: number;
    state: string;
    carrying: string | null;
    target: { x: number; z: number };
  };
}

interface SimCarrier {
  id: number;
  routeId: number;
  x: number;
  z: number;
  state: string;
  cargo: Array<{ ware: string; to: number }>;
  path: Array<{ x: number; z: number }>;
  cumulative: number[];
  pathLength: number;
  distance: number;
  legIndex: number;
  servicePhase: string;
  serviceTimer: number;
  transferAnim: number;
  serviceStop?: number;
  lastTransfer?: { kind: "load" | "unload"; ware: string };
}

interface SimState {
  time: number;
  options: { cartCapacity: number; transferAnimationSeconds: number; smartSkip: boolean };
  buildings: Map<number, SimBuilding>;
  carriers: SimCarrier[];
  routes: Array<{ id: number; color: string; stops: number[]; legs: Array<{ points: Array<{ x: number; z: number }> }> }>;
  flags: Map<number, { x: number; z: number; stock: Map<string, number>; totalCapacity: number; wareCapacity: number }>;
}

type SimModule = {
  createSimulation: (island: unknown, overrides?: Record<string, unknown>) => SimState;
  flagTotals: (state: SimState) => Array<{ uid: number; total: number; capacity: number }>;
  pointAt: (points: Array<{ x: number; z: number }>, cumulative: number[], distance: number) => { x: number; z: number };
  step: (state: SimState, dt: number) => void;
  summary: (state: SimState) => {
    time: number;
    routes: number;
    carriers: number;
    delivered: number;
    produced: number;
    cartUtilization: number;
    movingShare: number;
  };
};

interface Overlay {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  height: number;
  width: number;
}

interface FlagDemoFrame {
  workers?: readonly WorkerFrame[];
  handcarts?: readonly HandcartFrame[];
}

const appearanceAt = (appearances: readonly WorkerAppearance[], index: number): WorkerAppearance =>
  appearances[index % Math.max(1, appearances.length)] ?? { nation: "roman", variant: "a" };

const createWorker = (appearance: WorkerAppearance, actorId: number): WorkerFrame => ({
  nation: appearance.nation,
  variant: appearance.variant,
  actorId,
  x: 0, y: 0, z: 0,
  heading: 0,
  selected: false,
  visible: true,
  action: "idle_breathe",
  animationTime: 0,
  gaitPhase: 0,
  runBlend: 0,
  target: null,
  carryingWare: null,
  workerJob: "Carrier"
});

const createOverlay = (viewport: HTMLElement): Overlay => {
  const canvas = document.createElement("canvas");
  canvas.id = "flag-demo-overlay";
  canvas.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:40";
  document.body.append(canvas);
  const context = canvas.getContext("2d")!;
  const overlay = { canvas, context, height: 1, width: 1 };
  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = viewport.clientWidth;
    overlay.height = viewport.clientHeight;
    canvas.width = Math.max(1, Math.round(overlay.width * ratio));
    canvas.height = Math.max(1, Math.round(overlay.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  new ResizeObserver(resize).observe(viewport);
  window.addEventListener("resize", resize);
  resize();
  return overlay;
};

const createPanel = () => {
  const panel = document.createElement("div");
  panel.id = "flag-demo-panel";
  panel.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:1000;width:242px;max-height:52vh;overflow:auto;" +
    "padding:10px 11px;border:1px solid rgba(90,209,255,.34);border-radius:9px;background:rgba(9,16,23,.88);" +
    "color:#e6edf3;font:12px/1.45 ui-sans-serif,system-ui,sans-serif;backdrop-filter:blur(6px);pointer-events:auto";
  panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <strong style="font-size:13px">Flag logistics</strong>
      <button id="flag-demo-close" style="border:1px solid #3b4d5c;background:#18242e;color:#cfdae5;border-radius:6px;padding:2px 6px;cursor:pointer">Close</button>
    </div>
    <div style="color:#8b98a5;margin:2px 0 7px">Real engine · route-bound carriers + capped flags</div>
    <div id="flag-demo-stats" style="font-variant-numeric:tabular-nums"></div>
    <label style="display:flex;align-items:center;gap:5px;margin-top:7px;color:#aebbc7">
      <input id="flag-demo-routes" type="checkbox" checked> route lines
    </label>
    <label style="display:flex;align-items:center;gap:5px;color:#aebbc7">
      <input id="flag-demo-flags" type="checkbox" checked> flag stock
    </label>
    <label style="display:flex;align-items:center;gap:5px;color:#aebbc7">
      <input id="flag-demo-skip" type="checkbox"> skip empty stops
    </label>
    <div style="display:flex;align-items:center;gap:5px;margin-top:4px;color:#aebbc7">
      <input id="flag-demo-follow" type="checkbox" checked>
      <span>follow</span>
      <select id="flag-demo-carrier" style="flex:1;background:#101820;color:#e6edf3;border:1px solid #33414e;border-radius:5px;padding:2px 4px"></select>
    </div>
    <div id="flag-demo-note" style="color:#7f8d9a;margin-top:7px;font-size:10px;line-height:1.35">
      Visual prototype: normal carrier actors and carts are hidden; the settlement economy still runs unchanged.
    </div>`;
  document.body.append(panel);
  return {
    panel,
    stats: panel.querySelector<HTMLElement>("#flag-demo-stats")!,
    close: panel.querySelector<HTMLButtonElement>("#flag-demo-close")!,
    routes: panel.querySelector<HTMLInputElement>("#flag-demo-routes")!,
    flags: panel.querySelector<HTMLInputElement>("#flag-demo-flags")!,
    skip: panel.querySelector<HTMLInputElement>("#flag-demo-skip")!,
    follow: panel.querySelector<HTMLInputElement>("#flag-demo-follow")!,
    carrier: panel.querySelector<HTMLSelectElement>("#flag-demo-carrier")!
  };
};

export const createFlagDemo = (options: FlagDemoOptions) => {
  let sim: SimState | undefined;
  let module: SimModule | undefined;
  let ready = false;
  const carrierActors = new Map<number, DemoActor>();
  const porterActors = new Map<number, DemoActor>();
  const overlay = createOverlay(options.viewport);
  const panel = createPanel();
  let showRoutes = true;
  let showFlags = true;
  let follow = true;
  let followId = 1;
  let lastPanel = 0;
  let error = "";
  let latestWorkers: WorkerFrame[] | undefined;

  panel.routes.addEventListener("change", () => { showRoutes = panel.routes.checked; });
  panel.flags.addEventListener("change", () => { showFlags = panel.flags.checked; });
  panel.skip.addEventListener("change", () => {
    if (sim) sim.options.smartSkip = panel.skip.checked;
  });
  panel.follow.addEventListener("change", () => {
    follow = panel.follow.checked;
    if (follow) options.camera.zoom = Math.max(options.camera.zoom, 2.2);
  });
  panel.carrier.addEventListener("change", () => { followId = Number(panel.carrier.value); });
  panel.close.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("flagdemo");
    location.assign(url.href);
  });

  const groundAt = (x: number, z: number) => sampleSmooth(options.world, options.world.heights, x, z);

  const updatePanel = () => {
    if (!ready || !sim || !module) {
      panel.stats.textContent = error || "Loading the flag island…";
      return;
    }
    const report = module.summary(sim);
    const flags = module.flagTotals(sim);
    const nonHub = flags.filter(flag => flag.uid !== 0);
    const saturated = nonHub.filter(flag => {
      const state = sim!.flags.get(flag.uid);
      return state ? [...state.stock.values()].some(amount => amount >= state.wareCapacity) ||
        flag.total >= flag.capacity : false;
    }).length;
    panel.stats.innerHTML = `time <b>${Math.floor(report.time / 60)}:${String(Math.floor(report.time % 60)).padStart(2, "0")}</b>` +
      ` · routes <b>${report.routes}</b> · carriers <b>${report.carriers}</b><br>` +
      `delivered <b>${report.delivered}</b> · produced <b>${report.produced}</b><br>` +
      `saturated flags <b>${saturated}/${nonHub.length}</b> · cart load <b>${Math.round(report.cartUtilization * 100)}%</b>`;
  };

  const drawOverlay = () => {
    const context = overlay.context;
    context.clearRect(0, 0, overlay.width, overlay.height);
    if (!ready || !sim || !module) return;
    if (showRoutes) {
      for (const route of sim.routes) {
        context.strokeStyle = route.color;
        context.globalAlpha = 0.42;
        context.lineWidth = 2;
        for (const leg of route.legs) {
          context.beginPath();
          let started = false;
          for (let index = 0; index < leg.points.length; index += 2) {
            const point = leg.points[index]!;
            const screen = options.renderer.projectToViewport(point.x, groundAt(point.x, point.z) + 0.08, point.z);
            if (!started) { context.moveTo(screen.x, screen.y); started = true; }
            else context.lineTo(screen.x, screen.y);
          }
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }
    if (showFlags) {
      context.font = "10px ui-monospace, monospace";
      context.textAlign = "left";
      context.textBaseline = "middle";
      for (const building of sim.buildings.values()) {
        const flag = sim.flags.get(building.uid);
        if (!flag) continue;
        const total = [...flag.stock.values()].reduce((sum, value) => sum + value, 0);
        if (!total) continue;
        const screen = options.renderer.projectToViewport(flag.x,
          groundAt(flag.x, flag.z) + 0.9, flag.z);
        if (screen.x < -30 || screen.y < -30 || screen.x > overlay.width + 30 || screen.y > overlay.height + 30) continue;
        context.beginPath();
        context.arc(screen.x, screen.y, 4, 0, TAU);
        context.fillStyle = "rgba(9,16,23,.82)";
        context.fill();
        context.strokeStyle = "#e5d7ad";
        context.stroke();
        context.fillStyle = "#e6edf3";
        context.fillText(String(total), screen.x + 7, screen.y);
      }
      context.textBaseline = "alphabetic";
    }
  };

  const headingOf = (carrier: SimCarrier): number => {
    if (!module || carrier.state !== "travel") return 0;
    const ahead = module.pointAt(carrier.path, carrier.cumulative,
      Math.min(carrier.pathLength, carrier.distance + 0.35));
    const heading = Math.atan2(ahead.x - carrier.x, ahead.z - carrier.z);
    return Number.isFinite(heading) ? heading : 0;
  };

  const carrierFrame = (carrier: SimCarrier, dt: number, carts: HandcartFrame[]): WorkerFrame => {
    let state = carrierActors.get(carrier.id);
    if (!state) {
      state = {
        frame: createWorker(appearanceAt(options.appearances, carrier.id + 2), -1000 - carrier.id),
        cart: {
          id: 100000 + carrier.id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, wheelAngle: 0,
          count: 0, ware: null, load: "base"
        },
        heading: 0, gaitPhase: 0, lastX: carrier.x, lastZ: carrier.z, animationTime: 0, idle: 0
      };
      carrierActors.set(carrier.id, state);
    }
    const moved = Math.hypot(carrier.x - state.lastX, carrier.z - state.lastZ);
    state.lastX = carrier.x; state.lastZ = carrier.z;
    const targetHeading = carrier.state === "travel" ? headingOf(carrier) : state.heading;
    state.heading = turnYawToward(state.heading, targetHeading, 9 * dt);
    const frame = state.frame;
    frame.x = carrier.x;
    frame.z = carrier.z;
    frame.y = groundAt(carrier.x, carrier.z);
    frame.heading = state.heading;
    frame.workerJob = "Carrier";
    state.gaitPhase = advanceGaitPhase(state.gaitPhase, moved, 0);
    frame.gaitPhase = state.gaitPhase;
    const transfer = carrier.state === "service" && carrier.transferAnim > 0 ? carrier.lastTransfer : undefined;
    if (transfer) {
      frame.action = transfer.kind === "load" ? "pickup_material" : "putdown_material";
      frame.animationTime = (state.idle += dt);
      const stop = carrier.serviceStop === undefined ? undefined : sim!.flags.get(carrier.serviceStop);
      frame.wareTransfer = {
        direction: transfer.kind === "load" ? "pickup" : "putdown",
        ware: transfer.ware,
        progress: Math.max(0, Math.min(1, 1 - carrier.transferAnim / sim!.options.transferAnimationSeconds)),
        target: stop
          ? { x: stop.x, y: groundAt(stop.x, stop.z) + 0.45, z: stop.z }
          : { x: carrier.x, y: frame.y + 0.45, z: carrier.z }
      };
    } else {
      frame.action = carrier.state === "travel" ? "walk" : "idle_breathe";
      frame.animationTime = frame.action === "walk"
        ? locomotionClipTime("walk", state.gaitPhase) : (state.idle += dt);
      frame.wareTransfer = undefined;
    }
    const ahead = carrier.state === "travel"
      ? module!.pointAt(carrier.path, carrier.cumulative, Math.min(carrier.pathLength, carrier.distance + 0.45))
      : null;
    frame.target = ahead ? { x: ahead.x, z: ahead.z } : null;
    frame.carryingWare = null;
    const cart = cartCentreBehind(carrier.x, carrier.z, state.heading);
    const cartY = groundAt(cart.x, cart.z);
    frame.handcart = { x: cart.x, y: cartY, z: cart.z, yaw: state.heading, pitch: 0 };
    const cartFrame = state.cart!;
    cartFrame.x = cart.x; cartFrame.y = cartY; cartFrame.z = cart.z;
    cartFrame.yaw = state.heading;
    cartFrame.pitch = 0;
    cartFrame.count = carrier.cargo.length;
    cartFrame.ware = carrier.cargo[0]?.ware ?? null;
    cartFrame.load = cartLoadVariant(cartFrame.ware, cartFrame.count, 0);
    cartFrame.wheelAngle = (cartFrame.wheelAngle + moved / HANDCART.wheelRadius) % TAU;
    carts.push(cartFrame);
    return frame;
  };

  const porterFrame = (building: SimBuilding, dt: number): WorkerFrame => {
    let state = porterActors.get(building.uid);
    if (!state) {
      state = {
        frame: createWorker(appearanceAt(options.appearances, building.uid + 5), -2000 - building.uid),
        cart: null, heading: 0, gaitPhase: 0, lastX: building.worker.x, lastZ: building.worker.z,
        animationTime: 0, idle: 0
      };
      porterActors.set(building.uid, state);
    }
    const worker = building.worker;
    const moved = Math.hypot(worker.x - state.lastX, worker.z - state.lastZ);
    state.lastX = worker.x; state.lastZ = worker.z;
    const moving = worker.state === "moving" || moved > 0.0005;
    if (moving) {
      const heading = Math.atan2(worker.target.x - worker.x, worker.target.z - worker.z);
      state.heading = turnYawToward(state.heading, heading, 8 * dt);
    }
    const frame = state.frame;
    frame.x = worker.x;
    frame.z = worker.z;
    frame.y = groundAt(worker.x, worker.z);
    frame.heading = state.heading;
    frame.workerJob = "Carrier";
    frame.action = moving ? "walk" : "idle_breathe";
    frame.target = moving ? { x: worker.target.x, z: worker.target.z } : null;
    state.gaitPhase = advanceGaitPhase(state.gaitPhase, moved, 0);
    frame.gaitPhase = state.gaitPhase;
    frame.animationTime = frame.action === "walk"
      ? locomotionClipTime("walk", state.gaitPhase) : (state.idle += dt);
    frame.carryingWare = worker.carrying;
    frame.handcart = undefined;
    return frame;
  };

  const load = async () => {
    try {
      const island = await fetch(new URL("demo/flag-island.json", location.href)).then(response => {
        if (!response.ok) throw new Error(`Flag island not found (${response.status})`);
        return response.json();
      });
      // @ts-expect-error The standalone demo simulation is plain JS outside the app's TS include.
      module = await import("../../../demos/route-logistics/src/sim.js") as SimModule;
      sim = module.createSimulation(island, { eventCarriers: true });
      sim.options.smartSkip = panel.skip.checked;
      panel.carrier.innerHTML = sim.carriers.map(carrier =>
        `<option value="${carrier.id}">Carrier ${carrier.id}</option>`).join("");
      ready = true;
      if (follow) options.camera.zoom = Math.max(options.camera.zoom, 2.2);
      updatePanel();
    } catch (cause) {
      error = `Flag demo failed: ${String(cause)}`;
      console.error(error);
      updatePanel();
    }
  };
  void load();
  (window as unknown as { __flagDemo?: unknown }).__flagDemo = {
    get state() { return sim; },
    get module() { return module; },
    project: (x: number, y: number, z: number) => options.renderer.projectToViewport(x, y, z)
  };

  const update = <T extends FlagDemoFrame>(frame: T, dt: number): T => {
    if (!ready || !sim || !module) return frame;
    const step = Math.min(0.2, Math.max(0, dt));
    module.step(sim, step);
    const workers: WorkerFrame[] = [];
    for (const worker of frame.workers ?? []) {
      if (worker.workerJob === "Carrier") continue;
      workers.push(worker);
    }
    // The normal carts belong to the hidden carriers (and to sawmills). Hide them all so a
    // visible cart is always the one pulled by our demonstration carrier.
    const carts: HandcartFrame[] = [];
    const demoCarts: HandcartFrame[] = [];
    for (const carrier of sim.carriers) workers.push(carrierFrame(carrier, step, demoCarts));
    for (const building of sim.buildings.values()) workers.push(porterFrame(building, step));
    latestWorkers = workers;
    carts.push(...demoCarts);
    if (follow) {
      const carrier = sim.carriers.find(candidate => candidate.id === followId) ?? sim.carriers[0];
      if (carrier) {
        options.camera.centerX = carrier.x;
        options.camera.centerZ = carrier.z;
      }
    }
    drawOverlay();
    if (performance.now() - lastPanel > 250) { lastPanel = performance.now(); updatePanel(); }
    return { ...frame, workers, handcarts: carts } as T;
  };

  return {
    update,
    get workers() { return latestWorkers; }
  };
};
