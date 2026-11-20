type Page = import("playwright-core").Page;

/**
 * Field battle: every player soldier attack-moves on the nearest hostile field soldier, in game
 * seconds. Stored troops are called out first; an adventure island has no storage (its troops land).
 */
export const fightFieldBattle = (page: Page, seconds = 1500) => page.evaluate(limit => {
  const simulation = (window as any).__settlement.simulation;
  const home = simulation.home();
  if (home) simulation.callOutMilitary(["shield", "heavy", "archer", "cavalry"], home.access);
  const field = (faction: boolean) => simulation.militarySoldiers().filter((soldier: any) =>
    ((soldier.combat?.faction ?? 0) > 0) === faction && !soldier.stationed);
  const actor = (id: number) => simulation.frames().find((entry: any) => entry.uid === id);
  for (let second = 0; second < limit; second++) {
    const enemies = field(true);
    if (!enemies.length) return { cleared: true, seconds: second, survivors: field(false).length };
    if (second % 10 === 0) {
      const ours = field(false).map((soldier: any) => soldier.actor);
      const target = actor(enemies[0].actor);
      if (target && ours.length) simulation.commandMilitary(ours, { x: target.x, z: target.z }, "attackMove");
    }
    simulation.update(1);
  }
  return { cleared: false, left: field(true).length, survivors: field(false).length };
}, seconds);

/** Siege: player field soldiers attack every hostile fort in turn; captured forts turn to faction 0. */
export const besiegeForts = (page: Page, seconds = 2400) => page.evaluate(limit => {
  const simulation = (window as any).__settlement.simulation;
  const forts = () => simulation.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0);
  const field = () => simulation.militarySoldiers().filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0 &&
    !soldier.stationed);
  const orders: unknown[] = [];
  for (let second = 0; second < limit; second++) {
    const [fort] = forts();
    if (!fort) return { captured: true, orders, seconds: second };
    const attackers = field().filter((soldier: any) => soldier.combat?.type !== "archer");
    if (!attackers.length) return { captured: false, orders, reason: "no attackers left", left: forts().length };
    // One order per fort; repeating it would restart the approach and the door queue.
    if (!attackers.some((soldier: any) => soldier.combat?.siege === fort.uid))
      orders.push({ accepted: simulation.siegeMilitary(attackers.map((soldier: any) => soldier.actor), fort.uid),
        fort: fort.uid, second });
    simulation.update(1);
  }
  return { captured: false, orders: orders.slice(0, 6), reason: "time budget", left: forts().length };
}, seconds);

/**
 * Orders the siege of the first hostile fort and advances until `count` attackers wait idle under
 * its walls; returns the fort, its door and how far each waiting soldier stands from them (tiles).
 */
export const queueAtFortDoor = (page: Page, count = 4, seconds = 240) => page.evaluate(({ count, seconds }) => {
  const simulation = (window as any).__settlement.simulation;
  const fort = simulation.buildings().find((building: any) => (building.militaryFaction ?? 0) > 0);
  if (!fort) return null;
  const attackers = () => simulation.militarySoldiers().filter((soldier: any) =>
    (soldier.combat?.faction ?? 0) === 0 && !soldier.stationed && soldier.combat?.type !== "archer");
  // Soldiers still leaving a building cannot take the order yet; it is repeated for them.
  const order = () => {
    const idle = attackers().filter((soldier: any) => soldier.combat?.siege !== fort.uid);
    if (idle.length) simulation.siegeMilitary(idle.map((soldier: any) => soldier.actor), fort.uid);
  };
  const wallDistance = (body: any) => Math.hypot(Math.max(0, Math.abs(body.x - fort.x) - fort.width / 2),
    Math.max(0, Math.abs(body.z - fort.z) - fort.depth / 2));
  const waiting = () => simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.siege === fort.uid)
    .map((soldier: any) => simulation.frames().find((body: any) => body.uid === soldier.actor))
    .filter((body: any) => body?.phase === "militaryField" && body.action === "idle" && !body.path.length);
  // Soldiers stand idle for a moment right after the order; count only those already at the walls.
  const atWalls = () => waiting().filter((body: any) => wallDistance(body) < 3).length;
  for (let step = 0; step < seconds * 4 && atWalls() < count; step++) {
    if (step % 4 === 0) order();
    simulation.update(.25);
  }
  return { door: fort.access as { x: number; z: number }, fort: fort.typeId as number,
    wallDistances: waiting().map((body: any) => Math.round(wallDistance(body) * 100) / 100) as number[] };
}, { count, seconds });
