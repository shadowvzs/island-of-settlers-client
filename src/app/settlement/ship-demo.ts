import { layoutShipDeck, SHIP_DECK_PERSON_WORLD, type ShipDeckSlot } from "../../render-common/ships/ship-deck-layout";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import type { ShipFrame } from "../../render-common/ships/ship-frame";
import type { WorkerAppearance, WorkerFrame, WorkerNation } from "../../render-common/workers/worker-unit";

export type ShipDemoKind = "wares" | "settlers";
export interface ShipDeckPreviewControls {
  active(id: string): ShipDemoKind | undefined;
  canPreview(id: string): boolean;
  clear(): void;
  toggle(id: string, kind: ShipDemoKind): boolean;
}
const emptyIdleDeck = (ship: ShipFrame | undefined): ship is ShipFrame => Boolean(ship &&
  ship.phase === "idle" && !ship.livery && ship.cargoCount === 0 && !(ship.deckBoxes ?? 0) &&
  !(ship.deckPassengers ?? 0) && !ship.deckTroops?.length && !ship.cargoWork);

/** One ephemeral selected-ship preview; never stock, actors, fog, manifests or saved data. */
export const createShipDemo = () => {
  let demo: { id: number; kind: ShipDemoKind; slots: ShipDeckSlot[] } | undefined;
  const clear = () => { demo = undefined; };
  const toggle = (ship: ShipFrame | undefined, kind: ShipDemoKind) => {
    if (!emptyIdleDeck(ship)) return false;
    if (demo?.id === ship.id && demo.kind === kind) { clear(); return true; }
    const layout = layoutShipDeck(SHIP_DECK_PERSON_WORLD, kind === "settlers" ? Infinity : 0,
      kind === "wares" ? Infinity : 0);
    demo = { id: ship.id, kind, slots: layout.slots }; return true;
  };
  const reconcile = (ships: readonly ShipFrame[]) => {
    if (demo && !emptyIdleDeck(ships.find(ship => ship.id === demo!.id))) clear();
  };
  const shipFrames = (ships: readonly ShipFrame[]) => {
    reconcile(ships);
    if (!demo) return ships;
    return ships.map(ship => ship.id === demo!.id ? { ...ship,
      demoCrates: demo!.slots.filter(slot => slot.kind === "crate") } : ship);
  };
  const workerFrames = (ships: readonly ShipFrame[], templates: readonly WorkerAppearance[],
    nation: WorkerNation, time: number): WorkerFrame[] => {
    reconcile(ships);
    if (demo?.kind !== "settlers") return [];
    const ship = ships.find(ship => ship.id === demo!.id)!;
    const appearances = templates.filter(template => template.nation === nation);
    if (!appearances.length) return [];
    const c = Math.cos(ship.yaw), s = Math.sin(ship.yaw), scale = SAILING_SHIP_SCALE;
    return demo.slots.map((slot, index) => {
      const appearance = appearances[index % appearances.length]!;
      return { nation: appearance.nation, variant: appearance.variant,
        actorId: -2000000000 + index, workerJob: "Settler", visible: true,
        x: ship.x + scale * (slot.x * c + slot.z * s), z: ship.z + scale * (slot.z * c - slot.x * s),
        y: ship.y + scale * slot.y, heading: ship.yaw, action: "idle_breathe",
        selected: false, animationTime: time + index * .19, gaitPhase: 0, runBlend: 0, target: null };
    });
  };
  return { active: (id: number) => demo?.id === id ? demo.kind : undefined,
    canPreview: emptyIdleDeck, clear, toggle, reconcile, shipFrames, workerFrames };
};
