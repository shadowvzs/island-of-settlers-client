import { createRenderer } from "./render.js";
import {
  addBuilding, addCarrier, createSimulation, exportState, flagTotals, rebuildRoutes,
  removeBuilding, routeSummary, setOptions, step, summary, WARE_COLORS
} from "./sim.js";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const sum = values => [...values].reduce((total, value) => total + value, 0);
const formatClock = seconds => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
  return [hours, minutes, rest].map(value => String(value).padStart(2, "0")).join(":");
};
const formatNumber = value => Math.round(value).toLocaleString("en-US");
const percent = value => `${Math.round(value * 100)}%`;

const island = await fetch("./data/island.json").then(response => {
  if (!response.ok) throw new Error(`Could not load island.json (${response.status})`);
  return response.json();
});

const PRESETS = {
  balanced: {
    routeCount: 6, flagTotalCapacity: 18, flagWareCapacity: 6, cartCapacity: 8,
    productionScale: 1.5, carrierSpeed: 5
  },
  backpressure: {
    routeCount: 3, flagTotalCapacity: 8, flagWareCapacity: 3, cartCapacity: 6,
    productionScale: 3, carrierSpeed: 4
  },
  overcapacity: {
    routeCount: 8, flagTotalCapacity: 30, flagWareCapacity: 10, cartCapacity: 12,
    productionScale: 1, carrierSpeed: 6
  }
};

let sim = createSimulation(island, { eventCarriers: true });
const ui = {
  paused: false,
  speed: 1,
  labels: true,
  routes: true,
  workers: true,
  placement: false,
  placementType: island.catalog.find(entry => entry.role === "producer")?.typeId ?? island.catalog[0].typeId,
  selected: null,
  selectedRoute: null
};

const tooltip = $("#tooltip");
const renderer = createRenderer({
  canvas: $("#map"),
  island,
  getSim: () => sim,
  getUi: () => ui,
  tooltip,
  onSelect: selection => {
    ui.selected = selection;
    if (selection?.kind === "building") {
      const building = sim.buildings.get(selection.id);
      if (building && building.routeId !== null) ui.selectedRoute = building.routeId;
    } else if (selection?.kind === "carrier") {
      const carrier = sim.carriers.find(candidate => candidate.id === selection.id);
      if (carrier) ui.selectedRoute = carrier.routeId;
    }
    updateSelected();
    updateRoutes();
  },
  onPlace: (x, z) => {
    try {
      const building = addBuilding(sim, { typeId: ui.placementType, x, z });
      ui.placement = false;
      ui.selected = { kind: "building", id: building.uid };
      ui.selectedRoute = building.routeId;
      message(`Added ${building.name} at ${x.toFixed(1)}, ${z.toFixed(1)}. Routes rebuilt.`);
      renderer.fit();
      updateAll();
    } catch (error) {
      message(String(error), true);
    }
  }
});

const message = (text, bad = false) => {
  const element = $("#message");
  element.textContent = text;
  element.style.color = bad ? "var(--bad)" : "var(--muted)";
};

const syncSliders = () => {
  $("#flagCap").value = String(sim.options.flagTotalCapacity);
  $("#flagCapOut").textContent = String(sim.options.flagTotalCapacity);
  $("#wareCap").value = String(sim.options.flagWareCapacity);
  $("#wareCapOut").textContent = String(sim.options.flagWareCapacity);
  $("#cartCap").value = String(sim.options.cartCapacity);
  $("#cartCapOut").textContent = String(sim.options.cartCapacity);
  $("#prodSpeed").value = String(sim.options.productionScale);
  $("#prodSpeedOut").textContent = `${sim.options.productionScale}×`;
};

const reset = (options = sim.options) => {
  sim = createSimulation(island, { ...options });
  ui.selected = null;
  ui.selectedRoute = null;
  syncSliders();
  renderer.fit();
  updateAll();
};

const updateStats = () => {
  const report = summary(sim);
  const flags = flagTotals(sim);
  const nonHub = flags.filter(flag => flag.uid !== sim.hubUid);
  const saturated = nonHub.filter(flag =>
    flag.total >= flag.capacity || Object.values(flag.stock).some(amount => amount >= sim.options.flagWareCapacity)).length;
  const empty = nonHub.filter(flag => flag.total === 0).length;
  const throughput = sim.time > 0 ? report.delivered / (sim.time / 60) : 0;
  const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  $("#stats").innerHTML = [
    stat("delivered", formatNumber(report.delivered)),
    stat("produced", formatNumber(report.produced)),
    stat("used", formatNumber(report.used)),
    stat("consumed", formatNumber(report.consumed)),
    stat("units / min", throughput.toFixed(1)),
    stat("cart load", percent(report.cartUtilization)),
    stat("carriers moving", percent(report.movingShare)),
    stat("flags saturated", `${saturated}/${nonHub.length}`),
    stat("flags empty", `${empty}/${nonHub.length}`),
    stat("dock wait", `${report.dockWaitSeconds.toFixed(1)}s`)
  ].join("");
  $("#hudStats").textContent = `${formatNumber(report.delivered)} delivered · ${saturated} saturated · ` +
    `${report.cartUtilization ? percent(report.cartUtilization) : "0%"} cart load`;
  $("#clock").textContent = formatClock(sim.time);
  $("#seed").textContent = `seed ${island.seed} · ${sim.buildings.size} buildings · ${island.roads.length} road pieces`;
};

const updateRoutes = () => {
  const container = $("#routes");
  const routes = routeSummary(sim);
  container.innerHTML = routes.map(route => {
    const carriers = sim.carriers.filter(carrier => carrier.routeId === route.id).length;
    const selected = ui.selectedRoute === route.id ? " selected" : "";
    return `<div class="route${selected}" data-route="${route.id}">
      <span class="dot" style="background:${route.color}"></span>
      <span><span class="name">Route ${route.id + 1}</span>
        <span class="meta">${route.stops.length - 2} stops · ${carriers} carrier${carriers === 1 ? "" : "s"} · ` +
        `${route.legLengths.reduce((total, value) => total + value, 0).toFixed(0)} tiles</span></span>
      <button data-add-carrier="${route.id}" title="Add a carrier to this route">+</button>
    </div>`;
  }).join("");
  container.querySelectorAll("[data-route]").forEach(row => {
    row.addEventListener("click", () => {
      ui.selectedRoute = Number(row.dataset.route);
      ui.selected = { kind: "route", id: ui.selectedRoute };
      renderer.focusRoute(ui.selectedRoute);
      updateSelected();
      updateRoutes();
    });
  });
  container.querySelectorAll("[data-add-carrier]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      try {
        addCarrier(sim, Number(button.dataset.addCarrier));
        message(`Added a carrier to route ${Number(button.dataset.addCarrier) + 1}.`);
        updateAll();
      } catch (error) { message(String(error), true); }
    });
  });
};

const wareRows = map => {
  const entries = [...map.entries()].filter(([, amount]) => amount > 0)
    .sort(([first], [second]) => first.localeCompare(second));
  if (!entries.length) return `<p class="muted">empty</p>`;
  return entries.map(([ware, amount]) =>
    `<div class="ware-row"><span><i style="background:${WARE_COLORS[ware] ?? "#fff"}"></i>${escapeHtml(ware)}</span><b>${amount}</b></div>`).join("");
};

const updateSelected = () => {
  const container = $("#selected");
  if (!ui.selected) {
    container.innerHTML = `<p class="muted">Click a building or carrier.</p>`;
    return;
  }
  if (ui.selected.kind === "route") {
    const route = sim.routes.find(candidate => candidate.id === ui.selected.id);
    if (!route) { container.innerHTML = `<p class="muted">Route not found.</p>`; return; }
    const stops = route.stops.slice(1, -1).map(uid => sim.buildings.get(uid));
    container.innerHTML = `<h3>Route ${route.id + 1}</h3>
      <div><span class="tag">${stops.length} stops</span><span class="tag">${route.legs.length} legs</span></div>
      ${stops.map(building => `<div class="kv"><span>${escapeHtml(building.role)}</span><span>${escapeHtml(building.name)}</span></div>`).join("")}
      <div class="kv"><span>legs</span><span>${route.legs.map(leg => leg.length.toFixed(0)).join(" → ")} tiles</span></div>`;
    return;
  }
  if (ui.selected.kind === "carrier") {
    const carrier = sim.carriers.find(candidate => candidate.id === ui.selected.id);
    if (!carrier) { container.innerHTML = `<p class="muted">Carrier not found.</p>`; return; }
    const route = sim.routes.find(candidate => candidate.id === carrier.routeId);
    const next = sim.buildings.get(route.stops[carrier.legIndex + 1]);
    container.innerHTML = `<h3>Carrier ${carrier.id}</h3>
      <div><span class="tag">route ${carrier.routeId + 1}</span><span class="tag">${escapeHtml(carrier.state)}</span>
        <span class="tag">${carrier.cargo.length}/${sim.options.cartCapacity} cargo</span></div>
      <div class="kv"><span>next</span><b>${escapeHtml(next?.name ?? "—")}</b></div>
      <div class="kv"><span>delivered</span><b>${carrier.delivered}</b></div>
      <div class="kv"><span>waiting</span><b>${carrier.wait.toFixed(1)}s</b></div>
      <div class="kv"><span>position</span><b>${carrier.x.toFixed(1)}, ${carrier.z.toFixed(1)}</b></div>
      <h2 style="margin-top:10px">Cargo</h2>
      ${wareRows(new Map(carrier.cargo.map(unit => [unit.ware, 1])))}
      <div class="kv"><span>destinations</span><span>${carrier.cargo.map(unit =>
        escapeHtml(sim.buildings.get(unit.to)?.name ?? unit.to)).join(", ") || "—"}</span></div>`;
    return;
  }
  const building = sim.buildings.get(ui.selected.id);
  if (!building) { container.innerHTML = `<p class="muted">Building not found.</p>`; return; }
  const flag = sim.flags.get(building.uid);
  const total = sum(flag.stock.values());
  const production = building.outputs.length
    ? Math.round(100 * Math.min(1, building.internal.progress / building.seconds)) : 0;
  container.innerHTML = `<h3>${escapeHtml(building.name)}</h3>
    <div><span class="tag">#${building.uid}</span><span class="tag">${escapeHtml(building.role)}</span>
      ${building.routeId === null ? "" : `<span class="tag">route ${building.routeId + 1}</span>`}</div>
    <div class="kv"><span>flag</span><b>${total}/${flag.totalCapacity}</b></div>
    <div class="bar"><div style="width:${Math.min(100, 100 * total / flag.totalCapacity)}%"></div></div>
    <div class="kv"><span>worker</span><span>${escapeHtml(building.worker.state)}${building.worker.carrying
      ? ` · ${escapeHtml(building.worker.carrying)}` : ""}</span></div>
    <div class="kv"><span>production</span><span>${building.outputs.length
      ? `${production}% · ${escapeHtml(building.outputs.join(", "))}` : "—"}</span></div>
    <div class="bar"><div style="width:${production}%"></div></div>
    <div class="kv"><span>inputs</span><span>${building.inputs.length ? escapeHtml(building.inputs.join(", ")) : "—"}</span></div>
    <div class="kv"><span>internal in</span><span>${building.internal.inputs.size
      ? [...building.internal.inputs.entries()].map(([ware, amount]) => `${escapeHtml(ware)} ${amount}`).join(", ") : "—"}</span></div>
    <div class="kv"><span>internal out</span><span>${building.internal.outputs.size
      ? [...building.internal.outputs.entries()].map(([ware, amount]) => `${escapeHtml(ware)} ${amount}`).join(", ") : "—"}</span></div>
    <h2 style="margin-top:10px">Flag stock</h2>
    ${wareRows(flag.stock)}
    <h2 style="margin-top:10px">Reserved</h2>
    ${wareRows(flag.reserved)}`;
};

const updateEvents = () => {
  const list = sim.events.slice(-10).reverse();
  $("#events").innerHTML = list.length
    ? list.map(event => `<li class="${escapeHtml(event.type)}"><b>${formatClock(event.time)}</b> ${escapeHtml(event.message)}</li>`).join("")
    : `<li>No events yet.</li>`;
};

const updateAll = () => {
  updateStats();
  updateRoutes();
  updateSelected();
  updateEvents();
};

const download = (value, name) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Building catalog.
const typeSelect = $("#buildingType");
for (const entry of [...island.catalog].sort((first, second) => first.name.localeCompare(second.name))) {
  const option = document.createElement("option");
  option.value = String(entry.typeId);
  option.textContent = `${entry.name} (${entry.typeId}) · ${entry.role}`;
  typeSelect.append(option);
}
typeSelect.value = String(ui.placementType);

// Controls.
$("#play").addEventListener("click", () => {
  ui.paused = !ui.paused;
  $("#play").textContent = ui.paused ? "Resume" : "Pause";
});
$("#step").addEventListener("click", () => {
  if (!ui.paused) return;
  for (let index = 0; index < 10; index++) step(sim, 0.1);
  updateAll();
});
$("#fit").addEventListener("click", () => renderer.fit());
$("#speed").addEventListener("input", event => {
  ui.speed = Number(event.target.value);
  $("#speedOut").textContent = `${ui.speed}×`;
});
document.querySelectorAll("[data-preset]").forEach(button => {
  button.addEventListener("click", () => {
    reset({ ...sim.options, ...PRESETS[button.dataset.preset] });
    message(`Loaded the ${button.dataset.preset} preset.`);
  });
});
$("#rebuild").addEventListener("click", () => {
  rebuildRoutes(sim);
  ui.selected = null;
  ui.selectedRoute = null;
  message("Routes rebuilt and carriers respawned.");
  updateAll();
});
$("#addCarrier").addEventListener("click", () => {
  try {
    const routeId = ui.selectedRoute ?? sim.routes[0]?.id;
    if (routeId === undefined) throw new Error("No route available");
    addCarrier(sim, routeId);
    message(`Added a carrier to route ${routeId + 1}.`);
    updateAll();
  } catch (error) { message(String(error), true); }
});
$("#removeBuilding").addEventListener("click", () => {
  if (ui.selected?.kind !== "building") { message("Select a building first.", true); return; }
  try {
    removeBuilding(sim, ui.selected.id);
    ui.selected = null;
    ui.selectedRoute = null;
    message("Building removed and routes rebuilt.");
    updateAll();
  } catch (error) { message(String(error), true); }
});
$("#place").addEventListener("click", () => {
  ui.placement = !ui.placement;
  $("#place").classList.toggle("active", ui.placement);
  const entry = island.catalog.find(candidate => candidate.typeId === Number(typeSelect.value));
  ui.placementType = Number(typeSelect.value);
  message(ui.placement ? `Click the map to place ${entry?.name ?? "a building"}.` : "Placement cancelled.");
});
typeSelect.addEventListener("change", () => {
  ui.placementType = Number(typeSelect.value);
  if (ui.placement) {
    const entry = island.catalog.find(candidate => candidate.typeId === ui.placementType);
    message(`Click the map to place ${entry?.name ?? "a building"}.`);
  }
});
$("#export").addEventListener("click", () => {
  download(exportState(sim), `route-logistics-${Date.now()}.json`);
  message("State exported.");
});
$("#reset").addEventListener("click", () => {
  reset();
  message("Simulation reset.");
});
$("#labels").addEventListener("change", event => { ui.labels = event.target.checked; });
$("#routesToggle").addEventListener("change", event => { ui.routes = event.target.checked; });
$("#workersToggle").addEventListener("change", event => { ui.workers = event.target.checked; });
$("#flagCap").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("#flagCapOut").textContent = String(value);
  setOptions(sim, { flagTotalCapacity: value });
});
$("#wareCap").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("#wareCapOut").textContent = String(value);
  setOptions(sim, { flagWareCapacity: value });
});
$("#cartCap").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("#cartCapOut").textContent = String(value);
  setOptions(sim, { cartCapacity: value });
});
$("#prodSpeed").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("#prodSpeedOut").textContent = `${value}×`;
  setOptions(sim, { productionScale: value });
});

$("#seed").textContent = `seed ${island.seed} · ${island.buildings.length} buildings · ${island.roads.length} road pieces`;
syncSliders();
updateAll();

let lastFrame = performance.now(), lastUi = 0;
const frame = now => {
  const real = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!ui.paused) {
    let remaining = real * ui.speed;
    while (remaining > 1e-6) {
      const dt = Math.min(0.1, remaining);
      step(sim, dt);
      remaining -= dt;
    }
  }
  renderer.draw();
  if (now - lastUi > 180) {
    updateAll();
    lastUi = now;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
