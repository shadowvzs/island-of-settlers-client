import type { SimRules } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { isCampaignRunRowKey } from "../../../../island-of-settlers-shared/src/island-key";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import { canonicalJson } from "../../shared/settlement/settlement-state-hash";
import { rulesRevisionOf } from "../../shared/settlement/sim-rules";
import type { SaveSnapshot } from "../save-store/save-api-client";

type SnapshotRow = SaveSnapshot["islands"][number];

/**
 * The rules a server catch-up advances under (rev G4): `granted` = the revision the login's lease granted, for every
 * island; `byRevision` = the server's copies of each island's own pinned revision (background catch-up, no lease).
 * The API resolves both from its revision table; the snapshot's own documents are replaced, never trusted.
 */
export type CatchUpRules =
  | { granted: SimRules }
  | { byRevision: Readonly<Record<string, SimRules>> };

/** The pin an island gets: the server's copy, none for the legacy revision (a legacy island saves none). */
const pinOf = (rules: SimRules) => rulesRevisionOf(rules) === "legacy" ? undefined : rules;

const rowSettlement = (row: SnapshotRow) => (row.save.data as { settlement?: SettlementSaveV1 }).settlement;

/** The rules one island advances under; undefined keeps the row as it is. */
const rulesOfRow = (row: SnapshotRow, rules: CatchUpRules) => {
  if ("granted" in rules) return rules.granted;
  const revision = rulesRevisionOf(rowSettlement(row)?.gameRules);
  return Object.hasOwn(rules.byRevision, revision) ? rules.byRevision[revision] : undefined;
};

/** One island row pinned to the server's rules; the same row when it already carries exactly that pin. */
const pinnedRow = (row: SnapshotRow, catchUpRules: CatchUpRules): SnapshotRow => {
  const settlement = rowSettlement(row), rules = rulesOfRow(row, catchUpRules);
  if (!settlement || !rules || isCampaignRunRowKey(row.key)) return row;
  const pin = pinOf(rules);
  if (canonicalJson(settlement.gameRules) === canonicalJson(pin)) return row;
  const { gameRules: _previous, ...unpinned } = settlement;
  const next = pin ? { ...unpinned, gameRules: structuredClone(pin) } : unpinned;
  return { ...row, save: { ...row.save, data: { ...row.save.data, settlement: next } } };
};

/**
 * Pins every island of a stored snapshot to the server's rules before a catch-up advances it, so the caught-up
 * snapshot already carries them and the live adopt only confirms. Campaign runs never catch up and keep their own
 * pin. The same snapshot object when nothing changes (or without rules).
 */
export const pinSnapshotRules = (snapshot: SaveSnapshot, rules: CatchUpRules | undefined): SaveSnapshot => {
  if (!rules) return snapshot;
  const islands = snapshot.islands.map(row => pinnedRow(row, rules));
  return islands.every((row, index) => row === snapshot.islands[index]) ? snapshot : { ...snapshot, islands };
};
