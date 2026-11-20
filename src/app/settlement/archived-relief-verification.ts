import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import type { ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SaveSnapshot } from "../save-store/save-api-client";

const owns = (snapshot: SaveSnapshot, island: string) => {
  if (island === "home") return true;
  const match = /^colony-(\d+)$/.exec(island);
  if (!match) return false;
  return snapshot.colonies.some(colony => colony.expeditionId === Number(match[1]) && colony.data.status === "conquered");
};
const row = (snapshot: SaveSnapshot, island: string) => snapshot.islands.find(row => row.key === island);
const project = (snapshot: SaveSnapshot, island: string): SaveSnapshot => ({ ...snapshot,
  session: { ...snapshot.session, active: island === "home" ? null : Number(island.slice(7)) }
});

/** API supplies stored snapshots and a trusted per-island anchor; a client baseline is never accepted. */
export const archivedVerificationSnapshots = (base: SaveSnapshot, end: SaveSnapshot, proof: ArchivedIslandProof) => {
  if (proof.version !== FORMATS.archivedReliefProof.current || !proof.intervals.length || proof.intervals.length > 64 ||
    !owns(base, proof.island) || !owns(end, proof.island)) return null;
  const activeId = end.session.active;
  if (activeId != null && (typeof activeId !== "number" || !Number.isSafeInteger(activeId))) return null;
  let active = "home";
  if (typeof activeId === "number") active = end.adventures.some(adventure => adventure.expeditionId === activeId)
    ? `adventure-${activeId}` : `colony-${activeId}`;
  if (active === proof.island) return null;
  const first = row(base, proof.island), last = row(end, proof.island);
  if (!first || !last || proof.intervals.some(interval => interval.island !== proof.island || interval.gaps?.length))
    return null;
  const start = first.save.data as unknown as GameSaveV1, finish = last.save.data as unknown as GameSaveV1;
  const ticks = proof.intervals.reduce((sum, interval) => sum + interval.endTick - interval.baseTick, 0);
  if (!Number.isFinite(proof.coverage.from) || !Number.isFinite(proof.coverage.to) ||
    proof.coverage.from !== start.savedAt || proof.coverage.to !== finish.savedAt ||
    Math.abs(proof.coverage.to - proof.coverage.from - ticks * 50) > 1e-6) return null;
  return { base: project(base, proof.island), end: project(end, proof.island) };
};
