import { DMath } from "../../math/deterministic-math";
import { strengthPoints } from "../commander/director-forces";
import type { AreaRef } from "../commander/strategic-intents";
import type { KnownUnitRecord } from "../faction-knowledge";
import { probeUnitRead } from "../faction-vision-probe";
import type { SettlementContext } from "../settlement-types";
import { FACTION_AI_PROBE_KNOWN_SOLDIERS } from "./constants";
import type { FactionAiThreat } from "./faction-ai-types";

type KnowledgeContext = Pick<SettlementContext, "factionKnowledge">;

const keepEveryRecord = () => false;

/**
 * Visits what `faction` knows of enemy soldiers (plan §3.2, no omniscience): only its A13 knowledge, the last known
 * record of each soldier, never a live position. Every record read is reported to the A13 probe as a remembered
 * read, so the economy AI adds no unseen read.
 */
const visitKnownSoldiers = (
  context: KnowledgeContext, faction: number, visit: (record: Readonly<KnownUnitRecord>) => void
) => {
  const records = context.factionKnowledge?.remembered(faction, keepEveryRecord);
  if (!records) return;
  for (const record of records) {
    probeUnitRead(FACTION_AI_PROBE_KNOWN_SOLDIERS, faction,
      { remembered: true, uid: record.uid, x: record.x, z: record.z });
    visit(record);
  }
};

/** What `faction` knows of enemy soldiers, summed into `threat` (the strategic layer's read). */
export const readKnownThreat = (context: KnowledgeContext, faction: number, threat: FactionAiThreat) => {
  threat.health = 0;
  threat.soldiers = 0;
  visitKnownSoldiers(context, faction, record => {
    threat.health += record.health;
    threat.soldiers++;
  });
};

/** What the strategic intents weigh of the known enemy soldiers (EAI4b); strengths in director strength points. */
export interface KnownForces {
  /** Strength of the known soldiers inside the threat ring round the faction's base. */
  nearBase: number;
  /** Distance from the base centre to the nearest known soldier (Infinity: none known, or no base). */
  nearest: number;
  nearestX: number;
  nearestZ: number;
  soldiers: number;
  strength: number;
}

export const createKnownForces = (): KnownForces =>
  ({ nearBase: 0, nearest: Infinity, nearestX: 0, nearestZ: 0, soldiers: 0, strength: 0 });

/**
 * Sums the known enemy soldiers into `forces`; `base` (the faction's base post, absent without a building) and
 * `ring` (tiles beyond its radius) decide which of them threaten the base.
 */
export const readKnownForces = (
  context: KnowledgeContext, faction: number, base: AreaRef | undefined, ring: number, forces: KnownForces
) => {
  forces.nearBase = 0;
  forces.nearest = Infinity;
  forces.soldiers = 0;
  forces.strength = 0;
  visitKnownSoldiers(context, faction, record => {
    const strength = strengthPoints(record);
    forces.soldiers++;
    forces.strength += strength;
    if (!base) return;
    const span = DMath.hypot(record.x - base.x, record.z - base.z);
    if (span <= base.radius + ring) forces.nearBase += strength;
    if (span >= forces.nearest) return;
    forces.nearest = span;
    forces.nearestX = record.x;
    forces.nearestZ = record.z;
  });
};
