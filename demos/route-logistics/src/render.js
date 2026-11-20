// oxlint-disable max-lines
// oxlint-disable max-lines-per-function
import { WARE_COLORS } from "./sim.js";

const ROLE_COLORS = {
  hub: "#c9a227",
  producer: "#4f9d5d",
  consumer: "#c0604a",
  home: "#4f7fb5",
  service: "#7c8792",
  idle: "#5b6470"
};

const decodeBase64 = value => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const rgba = (hex, alpha) => {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
};

const buildTerrain = island => {
  const { width, height, heights, water } = island.terrain;
  const heightBytes = decodeBase64(heights), waterBytes = decodeBase64(water);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  for (let index = 0; index < width * height; index++) {
    const level = heightBytes[index] / 255;
    const isWater = waterBytes[index] > 0;
    let red, green, blue;
    if (isWater) {
      const depth = Math.max(0, Math.min(1, 1 - level * 2.2));
      red = 10 + 22 * (1 - depth);
      green = 34 + 52 * (1 - depth);
      blue = 64 + 74 * (1 - depth);
    } else if (level < 0.42) {
      red = 188; green = 176; blue = 128;
    } else if (level < 0.58) {
      red = 104; green = 134; blue = 76;
    } else if (level < 0.72) {
      red = 84; green = 112; blue = 63;
    } else if (level < 0.86) {
      red = 125; green = 125; blue = 108;
    } else {
      red = 164; green = 164; blue = 148;
    }
    const noise = ((index * 37) % 11) - 5;
    image.data[index * 4] = red + noise;
    image.data[index * 4 + 1] = green + noise;
    image.data[index * 4 + 2] = blue + noise;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

export const createRenderer = ({ canvas, island, getSim, getUi, onSelect, onPlace, tooltip }) => {
  const context = canvas.getContext("2d");
  const terrain = buildTerrain(island);
  const view = { scale: 10, offsetX: 0, offsetY: 0 };
  let width = 1, height = 1, dpr = 1;
  let hover = null, drag = null, pointer = { x: 0, y: 0 };
  let labelBoxes = [];

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const toScreen = (x, z) => ({
    x: (x - view.offsetX) * view.scale,
    y: (z - view.offsetY) * view.scale
  });
  const toWorld = (x, y) => ({
    x: x / view.scale + view.offsetX,
    z: y / view.scale + view.offsetY
  });

  const fit = () => {
    if (!island.buildings.length) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const building of island.buildings) {
      minX = Math.min(minX, building.x - building.width / 2);
      maxX = Math.max(maxX, building.x + building.width / 2);
      minZ = Math.min(minZ, building.z - building.depth / 2);
      maxZ = Math.max(maxZ, building.z + building.depth / 2);
    }
    for (const road of island.roads) {
      minX = Math.min(minX, road.a.x, road.b.x);
      maxX = Math.max(maxX, road.a.x, road.b.x);
      minZ = Math.min(minZ, road.a.z, road.b.z);
      maxZ = Math.max(maxZ, road.a.z, road.b.z);
    }
    const margin = 6;
    minX -= margin; minZ -= margin; maxX += margin; maxZ += margin;
    const scale = Math.min(width / (maxX - minX), height / (maxZ - minZ)) * 0.92;
    view.scale = Math.max(2, Math.min(40, scale));
    view.offsetX = minX + (maxX - minX) / 2 - width / (2 * view.scale);
    view.offsetY = minZ + (maxZ - minZ) / 2 - height / (2 * view.scale);
  };

  const focusRoute = routeId => {
    const sim = getSim();
    const route = sim.routes.find(candidate => candidate.id === routeId);
    if (!route) return;
    const buildings = route.stops.map(uid => sim.buildings.get(uid)).filter(Boolean);
    if (!buildings.length) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const building of buildings) {
      minX = Math.min(minX, building.x); maxX = Math.max(maxX, building.x);
      minZ = Math.min(minZ, building.z); maxZ = Math.max(maxZ, building.z);
    }
    const margin = 8;
    minX -= margin; minZ -= margin; maxX += margin; maxZ += margin;
    view.scale = Math.max(2, Math.min(30, Math.min(width / (maxX - minX), height / (maxZ - minZ)) * 0.85));
    view.offsetX = minX + (maxX - minX) / 2 - width / (2 * view.scale);
    view.offsetY = minZ + (maxZ - minZ) / 2 - height / (2 * view.scale);
  };

  const pick = (worldX, worldZ) => {
    const sim = getSim();
    let best = null, bestDistance = Infinity;
    for (const carrier of sim.carriers) {
      const next = Math.hypot(carrier.x - worldX, carrier.z - worldZ);
      if (next < 1.8 && next < bestDistance) { bestDistance = next; best = { kind: "carrier", id: carrier.id }; }
    }
    for (const building of sim.buildings.values()) {
      const halfWidth = building.width / 2 + 0.8, halfDepth = building.depth / 2 + 0.8;
      if (Math.abs(building.x - worldX) <= halfWidth && Math.abs(building.z - worldZ) <= halfDepth) {
        const next = Math.hypot(building.x - worldX, building.z - worldZ);
        if (next < bestDistance) { bestDistance = next; best = { kind: "building", id: building.uid }; }
      }
    }
    return best;
  };

  const updateTooltip = () => {
    if (!hover?.kind || drag?.moved) {
      tooltip.style.display = "none";
      return;
    }
    const sim = getSim();
    let html = "";
    if (hover.kind === "building") {
      const building = sim.buildings.get(hover.id);
      const flag = sim.flags.get(hover.id);
      const stock = [...flag.stock.entries()].filter(([, amount]) => amount > 0)
        .sort(([a], [b]) => a.localeCompare(b));
      html = `<strong>${building.name}</strong><span class="muted">#${building.uid} · ${building.role}` +
        `${building.routeId === null ? "" : ` · route ${building.routeId + 1}`}</span>` +
        `<div class="tooltip-grid"><span>Flag</span><b>${[...flag.stock.values()].reduce((sum, value) => sum + value, 0)}/${flag.totalCapacity}</b>` +
        `<span>Worker</span><b>${building.worker.state}${building.worker.carrying ? ` (${building.worker.carrying})` : ""}</b>` +
        `<span>Production</span><b>${building.outputs.length ? `${Math.round(100 * building.internal.progress / building.seconds)}%` : "—"}</b></div>` +
        (stock.length ? `<div class="tooltip-wares">${stock.map(([ware, amount]) =>
          `<span><i style="background:${WARE_COLORS[ware] ?? "#fff"}"></i>${ware} ${amount}</span>`).join("")}</div>` : "");
    } else {
      const carrier = sim.carriers.find(candidate => candidate.id === hover.id);
      const route = sim.routes.find(candidate => candidate.id === carrier.routeId);
      html = `<strong>Carrier ${carrier.id}</strong><span class="muted">route ${carrier.routeId + 1} · ${carrier.state}</span>` +
        `<div class="tooltip-grid"><span>Cargo</span><b>${carrier.cargo.length}/${sim.options.cartCapacity}</b>` +
        `<span>Next</span><b>${sim.buildings.get(route.stops[carrier.legIndex + 1])?.name ?? "—"}</b>` +
        `<span>Delivered</span><b>${carrier.delivered}</b></div>` +
        (carrier.cargo.length ? `<div class="tooltip-wares">${carrier.cargo.map(unit =>
          `<span><i style="background:${WARE_COLORS[unit.ware] ?? "#fff"}"></i>${unit.ware} → ${sim.buildings.get(unit.to)?.name ?? unit.to}</span>`).join("")}</div>` : "");
    }
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const x = Math.min(width - tooltip.offsetWidth - 12, pointer.x + 16);
    const y = Math.min(height - tooltip.offsetHeight - 12, pointer.y + 16);
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  };

  const drawTerrain = () => {
    context.fillStyle = "#08131f";
    context.fillRect(0, 0, width, height);
    const start = toScreen(0, 0);
    context.globalAlpha = 0.96;
    context.drawImage(terrain, 0, 0, terrain.width, terrain.height,
      start.x, start.y, island.size.cellsX * view.scale, island.size.cellsZ * view.scale);
    context.globalAlpha = 1;
  };

  const drawRoads = () => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    for (const road of island.roads) {
      const first = toScreen(road.a.x, road.a.z), second = toScreen(road.b.x, road.b.z);
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
    }
    context.strokeStyle = "rgba(42,32,24,.85)";
    context.lineWidth = Math.max(1.2, view.scale * 0.34);
    context.stroke();
    context.strokeStyle = "rgba(166,140,104,.72)";
    context.lineWidth = Math.max(0.6, view.scale * 0.16);
    context.stroke();
  };

  const drawRoutes = ui => {
    if (!ui.routes) return;
    const sim = getSim();
    for (const route of sim.routes) {
      const selected = ui.selectedRoute === route.id;
      context.strokeStyle = rgba(route.color, selected ? 0.62 : 0.13);
      context.lineWidth = selected ? Math.max(2, view.scale * 0.22) : Math.max(0.8, view.scale * 0.1);
      context.setLineDash(selected ? [8, 6] : []);
      for (const leg of route.legs) {
        context.beginPath();
        leg.points.forEach((point, index) => {
          const screen = toScreen(point.x, point.z);
          if (index === 0) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
        });
        context.stroke();
      }
    }
    context.setLineDash([]);
  };

  const drawFlag = (building, flag, selected) => {
    const point = toScreen(flag.x, flag.z);
    const total = [...flag.stock.values()].reduce((sum, value) => sum + value, 0);
    const saturated = total >= flag.totalCapacity ||
      [...flag.stock.values()].some(amount => amount >= flag.wareCapacity);
    context.strokeStyle = "#e5d7ad";
    context.lineWidth = Math.max(1.2, view.scale * 0.12);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x, point.y - Math.max(10, view.scale * 0.9));
    context.stroke();
    context.fillStyle = saturated ? "#e0603a" : "#e5d7ad";
    context.beginPath();
    context.arc(point.x, point.y - Math.max(10, view.scale * 0.9), Math.max(2, view.scale * 0.16), 0, Math.PI * 2);
    context.fill();

    const entries = [...flag.stock.entries()].filter(([, amount]) => amount > 0)
      .sort((first, second) => second[1] - first[1]);
    let column = 0, row = 0;
    for (const [ware] of entries.slice(0, 7)) {
      const color = WARE_COLORS[ware] ?? "#ffffff";
      const x = point.x + (column - Math.min(2, entries.length - 1) / 2) * 7;
      const y = point.y + 8 + row * 7;
      context.fillStyle = color;
      context.strokeStyle = "rgba(0,0,0,.55)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, Math.max(1.8, view.scale * 0.13), 0, Math.PI * 2);
      context.fill();
      context.stroke();
      column++;
      if (column >= 3) { column = 0; row++; }
    }
    if (total > 0) {
      context.font = `${Math.max(8, view.scale * 0.55)}px ui-monospace, monospace`;
      context.textAlign = "left";
      context.fillStyle = "rgba(235,242,248,.9)";
      context.fillText(String(total), point.x + 14, point.y + 8);
    }
    const barWidth = Math.max(12, view.scale * 1.3), barHeight = Math.max(2, view.scale * 0.14);
    context.fillStyle = "rgba(0,0,0,.55)";
    context.fillRect(point.x - barWidth / 2, point.y + 15, barWidth, barHeight);
    let barColor = "rgba(255,255,255,.25)";
    if (saturated) barColor = "#e0603a";
    else if (total > 0) barColor = "#6fbf73";
    context.fillStyle = barColor;
    context.fillRect(point.x - barWidth / 2, point.y + 15, barWidth * Math.min(1, total / flag.totalCapacity), barHeight);
    if (selected) {
      context.strokeStyle = "#5ad1ff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y - 2, Math.max(8, view.scale * 0.7), 0, Math.PI * 2);
      context.stroke();
    }
  };

  const drawBuilding = (building, ui) => {
    const sim = getSim();
    const point = toScreen(building.x, building.z);
    const halfWidth = building.width / 2 * view.scale, halfDepth = building.depth / 2 * view.scale;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(building.rotation * Math.PI / 2);
    context.fillStyle = rgba(ROLE_COLORS[building.role] ?? "#5b6470", 0.88);
    context.strokeStyle = "rgba(4,8,12,.85)";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(-halfWidth, -halfDepth, halfWidth * 2, halfDepth * 2, Math.max(2, view.scale * 0.22));
    context.fill();
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,.24)";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(-halfWidth + 2, -halfDepth + 2, halfWidth * 2 - 4, halfDepth * 2 - 4, Math.max(1, view.scale * 0.16));
    context.stroke();
    context.restore();

    if (ui.labels && view.scale > 5.5) {
      context.font = `${Math.max(8, Math.min(11, view.scale * 0.72))}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = "center";
      const textWidth = context.measureText(building.name).width;
      const box = {
        left: point.x - textWidth / 2 - 3, right: point.x + textWidth / 2 + 3,
        top: point.y + halfDepth + 1, bottom: point.y + halfDepth + 15
      };
      const overlaps = labelBoxes.some(other => !(box.right < other.left || box.left > other.right ||
        box.bottom < other.top || box.top > other.bottom));
      if (!overlaps) {
        labelBoxes.push(box);
        context.fillStyle = "rgba(6,10,14,.72)";
        context.fillText(building.name, point.x + 1, point.y + halfDepth + 12);
        context.fillStyle = "#dfe8f2";
        context.fillText(building.name, point.x, point.y + halfDepth + 11);
      }
    }
    const selected = ui.selected?.kind === "building" && ui.selected.id === building.uid;
    if (selected) {
      context.strokeStyle = "#5ad1ff";
      context.lineWidth = 2.5;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(building.rotation * Math.PI / 2);
      context.beginPath();
      context.roundRect(-halfWidth - 2, -halfDepth - 2, halfWidth * 2 + 4, halfDepth * 2 + 4, Math.max(2, view.scale * 0.24));
      context.stroke();
      context.restore();
    }
    drawFlag(building, sim.flags.get(building.uid), selected);
  };

  const drawWorker = building => {
    const worker = building.worker;
    const point = toScreen(worker.x, worker.z);
    if (view.scale > 7) {
      const target = toScreen(worker.target.x, worker.target.z);
      context.strokeStyle = "rgba(220,235,250,.12)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(target.x, target.y);
      context.stroke();
    }
    context.fillStyle = "#e8f1ff";
    context.strokeStyle = "rgba(10,20,30,.8)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(point.x, point.y, Math.max(1.5, view.scale * 0.13), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  };

  const drawCarrier = (carrier, ui) => {
    const sim = getSim();
    const route = sim.routes.find(candidate => candidate.id === carrier.routeId);
    const point = toScreen(carrier.x, carrier.z);
    const selected = ui.selected?.kind === "carrier" && ui.selected.id === carrier.id;
    const hovered = hover?.kind === "carrier" && hover.id === carrier.id;
    const length = Math.max(7, view.scale * 0.85), height = Math.max(4, view.scale * 0.5);
    context.save();
    context.translate(point.x, point.y);
    context.fillStyle = route?.color ?? "#ffffff";
    let stroke = "rgba(4,8,12,.9)";
    if (selected) stroke = "#5ad1ff";
    else if (hovered) stroke = "#ffffff";
    context.strokeStyle = stroke;
    context.lineWidth = selected ? 2.5 : 1.5;
    context.beginPath();
    context.roundRect(-length / 2, -height / 2, length, height, height * 0.35);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(10,16,20,.9)";
    context.beginPath();
    context.arc(-length * 0.28, height * 0.52, Math.max(1, height * 0.2), 0, Math.PI * 2);
    context.arc(length * 0.28, height * 0.52, Math.max(1, height * 0.2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    const cargo = carrier.cargo.length;
    for (let index = 0; index < cargo; index++) {
      const color = WARE_COLORS[carrier.cargo[index].ware] ?? "#fff";
      context.fillStyle = color;
      context.strokeStyle = "rgba(0,0,0,.6)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(point.x + (index - (cargo - 1) / 2) * 4, point.y - height - 3, 1.8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    if (view.scale > 9) {
      context.font = `${Math.max(8, view.scale * 0.5)}px ui-monospace, monospace`;
      context.textAlign = "center";
      context.fillStyle = "rgba(235,242,248,.85)";
      context.fillText(`R${carrier.routeId + 1}`, point.x, point.y + height + 9);
    }
  };

  const drawHud = () => {
    const sim = getSim();
    const ui = getUi();
    if (ui.placement && hover) {
      const catalog = island.catalog.find(entry => entry.typeId === ui.placementType);
      if (catalog) {
        const world = toWorld(pointer.x, pointer.y);
        const ghost = toScreen(world.x, world.z);
        const w = catalog.footprint[0] * view.scale, h = catalog.footprint[1] * view.scale;
        context.fillStyle = "rgba(90,209,255,.18)";
        context.strokeStyle = "#5ad1ff";
        context.lineWidth = 2;
        context.setLineDash([5, 4]);
        context.fillRect(ghost.x - w / 2, ghost.y - h / 2, w, h);
        context.strokeRect(ghost.x - w / 2, ghost.y - h / 2, w, h);
        context.setLineDash([]);
      }
    }
    const hub = sim.flags.get(sim.hubUid);
    if (hub && sim.docks.queue.length) {
      const point = toScreen(hub.x, hub.z);
      context.fillStyle = "rgba(224,96,58,.95)";
      context.beginPath();
      context.arc(point.x + 14, point.y - 14, Math.max(5, view.scale * 0.4), 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff";
      context.font = `${Math.max(9, view.scale * 0.55)}px ui-monospace, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(sim.docks.queue.length), point.x + 14, point.y - 14);
      context.textBaseline = "alphabetic";
    }
    context.strokeStyle = "rgba(255,255,255,.55)";
    context.lineWidth = 1.5;
    const tiles = 5, bar = tiles * view.scale;
    context.beginPath();
    context.moveTo(16, height - 18);
    context.lineTo(16 + bar, height - 18);
    context.moveTo(16, height - 22);
    context.lineTo(16, height - 14);
    context.moveTo(16 + bar, height - 22);
    context.lineTo(16 + bar, height - 14);
    context.stroke();
    context.fillStyle = "rgba(255,255,255,.65)";
    context.font = "10px ui-monospace, monospace";
    context.textAlign = "left";
    context.fillText(`${tiles} tiles`, 16, height - 26);
  };

  const draw = () => {
    const sim = getSim();
    const ui = getUi();
    labelBoxes = [];
    drawTerrain();
    drawRoutes(ui);
    drawRoads();
    for (const building of [...sim.buildings.values()].sort((a, b) => a.z - b.z || a.x - b.x))
      drawBuilding(building, ui);
    if (ui.workers) for (const building of sim.buildings.values()) drawWorker(building);
    for (const carrier of sim.carriers) drawCarrier(carrier, ui);
    const hoveredBuilding = hover?.kind === "building" ? sim.buildings.get(hover.id) : null;
    if (hoveredBuilding) {
      const point = toScreen(hoveredBuilding.x, hoveredBuilding.z);
      context.strokeStyle = "rgba(255,255,255,.65)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(12, view.scale * 1.1), 0, Math.PI * 2);
      context.stroke();
    }
    drawHud();
    updateTooltip();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const updatePointer = event => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = toWorld(pointer.x, pointer.y);
    hover = pick(world.x, world.z);
    if (hover) {
      hover.worldX = world.x;
      hover.worldZ = world.z;
    } else hover = { worldX: world.x, worldZ: world.z };
  };

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    updatePointer(event);
    drag = { x: event.clientX, y: event.clientY, offsetX: view.offsetX, offsetY: view.offsetY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    updatePointer(event);
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      view.offsetX = drag.offsetX - dx / view.scale;
      view.offsetY = drag.offsetY - dy / view.scale;
    }
  });
  canvas.addEventListener("pointerup", event => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    updatePointer(event);
    const ui = getUi();
    const world = toWorld(pointer.x, pointer.y);
    if (ui.placement) onPlace(world.x, world.z);
    else if (hover?.kind) onSelect({ kind: hover.kind, id: hover.id });
    else onSelect(null);
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    tooltip.style.display = "none";
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const before = toWorld(px, py);
    const factor = Math.exp(-event.deltaY * 0.0015);
    view.scale = Math.max(1.5, Math.min(60, view.scale * factor));
    view.offsetX = before.x - px / view.scale;
    view.offsetY = before.z - py / view.scale;
  }, { passive: false });
  canvas.addEventListener("contextmenu", event => event.preventDefault());

  new ResizeObserver(() => { resize(); }).observe(canvas);
  resize();
  fit();

  return {
    draw,
    fit,
    focusRoute,
    resize,
    getView: () => ({ ...view }),
    setView: next => Object.assign(view, next),
    get hover() { return hover; }
  };
};
