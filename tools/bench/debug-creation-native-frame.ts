/** Native fixture helpers; use canonical rules and real simulation/renderer data without changing production maps. */
export const prepareDebugCreationFrame = async () => {
  const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
  const { snapshotAtmosphereFrame } = await import("./atmosphere-frame-snapshot");
  const { createSeaMask } = await import("../../src/shared/settlement/settlement-sea-navigation");
  const { createShipRoutePlanner } = await import("../../src/shared/settlement/settlement-ship-routes");
  const held = live.update(0);
  debug.liveUpdate = live.update; live.update = () => held;
  debug.snapshotFrame = snapshotAtmosphereFrame; debug.freeze();
  await debug.vegetation.ready;
  await debug.api.prepareFrame(debug.frozenFrame);
  const world = debug.world, planner = createShipRoutePlanner(world, createSeaMask(world));
  const points: Array<{ x: number; z: number }> = [];
  for (let z = 16; z < world.cellsZ - 16; z += 2) for (let x = 16; x < world.cellsX - 16; x += 2) {
    if (!planner.masks.turning[z * world.cellsX + x]) continue;
    if (points.some(point => Math.hypot(point.x - x, point.z - z) < 20)) continue;
    if (live.simulation.ships().some((ship: any) => Math.hypot(ship.x - x, ship.z - z) < 20)) continue;
    points.push({ x: x + .25, z: z + .25 });
    if (points.length === 2) return { points, shipsBefore: live.simulation.ships().length,
      nation: live.simulation.playerNation() };
  }
  throw new Error("Native map has insufficient safe open sea for two exact-click ships");
};

export const focusDebugCreationPoint = async (point: { x: number; y?: number; z: number }, zoom = 3.5) => {
  const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
  const { rotateAroundUp } = await import("../../src/render-common/camera-state");
  const { ISO_PITCH } = await import("../../src/render-common/iso-projection");
  const direction = rotateAroundUp(Math.SQRT1_2, Math.SQRT1_2, .5);
  const height = point.y ?? debug.world.seaLevel;
  const horizontal = height / Math.tan(ISO_PITCH - .2);
  Object.assign(debug.frozenFrame, debug.liveUpdate(0), { workers: live.workerFrames });
  Object.assign(debug.frozenFrame.camera, { centerX: point.x - direction.x * horizontal,
    centerZ: point.z - direction.z * horizontal, tilt: -.2, yaw: .5, zoom });
  debug.frozenFrame.time = 42; debug.frozenFrame.exploration = null;
  if (debug.frozenFrame.workers.length) await debug.api.prepareFrame(debug.frozenFrame);
  debug.draw();
  const screen = debug.api.projectToViewport(point.x, height, point.z);
  return { screen, seaPick: debug.api.pickWater(screen.x, screen.y), ships: live.simulation.ships(),
    frameShips: debug.frozenFrame.ships.map((ship: any) => ({ id: ship.id, nation: ship.nation, x: ship.x, z: ship.z })) };
};

export const reviewDebugCreationTroops = async () => {
  const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
  const simulation = live.simulation;
  // The authoritative spawn already validates terrain and occupancy; rejected trial points do not add units.
  let friendly: any = null, point: { x: number; z: number } | undefined;
  const home = simulation.headquarters;
  for (let dz = 8; dz <= 20 && !friendly; dz += 2) for (let dx = 8; dx <= 20 && !friendly; dx += 2) {
    const candidate = { x: home.x + dx, z: home.z + dz };
    if (candidate.x >= debug.world.cellsX - 4 || candidate.z >= debug.world.cellsZ - 4) continue;
    // Only the command owns admission; no test-only march or combat orders are issued.
    friendly = simulation.spawnDebugSoldier(candidate, { rank: 2, type: "heavy" });
    if (friendly) point = candidate;
  }
  if (!friendly || !point) throw new Error("No legal native friendly debug spawn");
  const initial = structuredClone(simulation.frames().find((actor: any) => actor.uid === friendly.id));
  const admitted = structuredClone(simulation.militarySoldiers().find((soldier: any) => soldier.actor === friendly.id));
  let enemy: any;
  for (const offset of [3, -3, 5, -5]) {
    enemy = simulation.spawnDebugEnemy({ x: point.x + offset, z: point.z }, { rank: 0, type: "shield" });
    if (enemy) break;
  }
  if (!enemy) throw new Error("No reachable native hostile debug spawn");
  const raider = structuredClone(simulation.militarySoldiers().find((soldier: any) => soldier.actor === enemy.id));
  let fought = false, tick = 0;
  for (; tick < 600; tick++) {
    debug.liveUpdate(.05);
    const own = simulation.militarySoldiers().find((soldier: any) => soldier.actor === friendly.id);
    const foe = simulation.militarySoldiers().find((soldier: any) => soldier.actor === enemy.id);
    if (!own || !foe || own.combat.hp < admitted.combat.hp || foe.combat.hp < raider.combat.hp) {
      fought = true; break;
    }
  }
  Object.assign(debug.frozenFrame, debug.liveUpdate(0), { workers: live.workerFrames });
  const actors = debug.frozenFrame.workers.filter((actor: any) => [friendly.id, enemy.id].includes(actor.actorId));
  return { admitted, enemy, fought, friendly, initial, raider, tick, actors: actors.map((actor: any) => ({
    actorId: actor.actorId, action: actor.action, combat: actor.combat, visible: actor.visible, x: actor.x, z: actor.z
  })) };
};
