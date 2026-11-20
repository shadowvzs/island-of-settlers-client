import type { MilitaryOrder } from "./military-targeting";
import type { SettlementPoint } from "./settlement-types";

/** A march the smart commander did not order (a raid party's march, a scenario's order). */
export interface CommanderObjective extends SettlementPoint {
  order: MilitaryOrder;
}

export interface ObjectiveUnit extends SettlementPoint {
  uid: number;
  /** Marching on an order: only an attack or a retreat replaces it. */
  marching: boolean;
  destination?: SettlementPoint;
  order?: MilitaryOrder;
}

/** `diverted`: the commander turned the soldier aside; the objective waits to be resumed. */
interface Objective extends CommanderObjective {
  diverted: boolean;
}

/**
 * Objectives the smart commander keeps for its soldiers (docs/archive/dated/military-motion-2026-10-13.md section 8):
 * when it turns a marching soldier aside (to attack a foe nearby or to retreat), the soldier's own
 * march is remembered and resumed once the squad would otherwise just defend, so a raid party still
 * reaches its goal and a scripted march still ends where it was sent. An objective ends when its
 * march (or the resumed one) is done. Explicit snapshot/restore retains these objectives across saves.
 */
export const createCommanderObjectives = () => {
  const objectives = new Map<number, Objective>();
  /** Soldiers marching on a commander order: true when that order resumes their objective. */
  const led = new Map<number, boolean>();
  return {
    /** Watches a soldier at each decision: records its own march, ends finished objectives. */
    observe: (unit: ObjectiveUnit) => {
      if (led.has(unit.uid)) {
        if (unit.marching) return;
        // The resumed march is over; an ended diversion keeps the objective.
        if (led.get(unit.uid)) objectives.delete(unit.uid);
        led.delete(unit.uid);
        return;
      }
      if (unit.marching && unit.destination && unit.order) {
        objectives.set(unit.uid, { ...unit.destination, diverted: false, order: unit.order });
        return;
      }
      if (!objectives.get(unit.uid)?.diverted) objectives.delete(unit.uid);
    },
    /** The commander sent these soldiers; `resuming`: back to their objective. */
    lead: (ids: readonly number[], resuming: boolean) => {
      for (const id of ids) {
        led.set(id, resuming);
        const objective = objectives.get(id);
        if (objective) objective.diverted = !resuming;
      }
    },
    /** Retreating on an order the commander did not give: only another retreat replaces it. */
    isOwnRetreat: (unit: ObjectiveUnit) =>
      unit.marching && unit.order === "retreat" && !led.has(unit.uid),
    /** The squad's objective: the centre of its members' objectives, with the first member's order. */
    of: (squad: readonly ObjectiveUnit[]): CommanderObjective | undefined => {
      let first: Objective | undefined,
        count = 0,
        x = 0,
        z = 0;
      for (const unit of squad) {
        const goal = objectives.get(unit.uid);
        if (!goal) continue;
        first ??= goal;
        count++;
        x += goal.x;
        z += goal.z;
      }
      return first && { order: first.order, x: x / count, z: z / count };
    },
    /** Drops soldiers no longer in the field. */
    keep: (present: ReadonlySet<number>) => {
      for (const uid of objectives.keys()) if (!present.has(uid)) objectives.delete(uid);
      for (const uid of led.keys()) if (!present.has(uid)) led.delete(uid);
    },
    save: () => ({ objectives: structuredClone([...objectives]), led: [...led] }),
    restore: (
      saved: { objectives: [number, Objective][]; led: [number, boolean][] } | undefined
    ) => {
      objectives.clear();
      led.clear();
      for (const [uid, objective] of saved?.objectives ?? []) objectives.set(uid, { ...objective });
      for (const [uid, resuming] of saved?.led ?? []) led.set(uid, resuming);
    },
    clear: () => {
      objectives.clear();
      led.clear();
    }
  };
};
