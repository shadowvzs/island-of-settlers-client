/**
 * A13 illegal-read probe (tests and benches only). Off unless a bench installs a recorder: the
 * instrumented AI call sites then report every enemy position they read, and the probe sorts each read:
 * - seen: the reading faction's vision layer covers the position;
 * - alerted: unseen, but the unit is under the faction's hit alert (allowed by design, phase 3);
 * - remembered: a last-known memory the commander reads (a remembered position, not live state);
 * - ruleAllowed: neither seen nor alerted, read by a faction whose troops the pinned sight rule lets act on every
 *   enemy (the player troop sight rule off, owner 2026-11-13);
 * - unseen: anything else, an illegal read (the phase-3 gate: 0 on every fixture).
 * Like the tick phase recorder it reads and writes no simulation state, so the state hash is identical
 * with and without it. The site's file:line is taken from one stack trace the first time the site reports.
 */
export interface VisionProbePoint {
  /** A last-known memory, not the unit's live position. */
  remembered?: boolean;
  uid?: number;
  x: number;
  z: number;
}

export interface VisionProbeSite {
  /** Unseen reads of a unit under the reading faction's hit alert (allowed). */
  alerted: number;
  /** `file:line` of the instrumented read (first report). */
  location: string;
  reads: number;
  /** Reads of a remembered (last known) position (allowed). */
  remembered: number;
  /** Unseen, unalerted reads the pinned player troop sight rule allows (rule off). */
  ruleAllowed: number;
  site: string;
  /** Reads of a live position the reading faction neither sees nor is alerted to (illegal). */
  unseen: number;
}

type VisionSees = (faction: number, x: number, z: number) => boolean;

/**
 * What the probe compares a read with: the vision layer, the faction knowledge's hit alerts and whether the sight
 * rule waives knowledge for the reading faction.
 */
export interface VisionProbeView {
  alerted?: (faction: number, uid: number) => boolean;
  ruleAllows?: (faction: number) => boolean;
  sees: VisionSees;
}

interface ActiveProbe {
  /** Bound to each newly created simulation's layer (benches that cannot reach the simulation). */
  followsLatest: boolean;
  sites: Map<string, VisionProbeSite>;
  view: VisionProbeView;
}

let probe: ActiveProbe | null = null;

const PROBE_FILE = "faction-vision-probe";

/** The first stack frame outside this module: the instrumented call site. */
const callerLocation = () => {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  const frame = frames.find(line => !line.includes(PROBE_FILE)) ?? "";
  const match = /([^/\\(\s]+\.[cm]?[jt]s):(\d+)/.exec(frame);
  return match ? `${match[1]}:${match[2]}` : "unknown";
};

const siteOf = (active: ActiveProbe, site: string) => {
  let entry = active.sites.get(site);
  if (!entry) {
    entry = { alerted: 0, location: callerLocation(), reads: 0, remembered: 0, ruleAllowed: 0, site, unseen: 0 };
    active.sites.set(site, entry);
  }
  return entry;
};

const record = (active: ActiveProbe, entry: VisionProbeSite, faction: number, point: VisionProbePoint) => {
  entry.reads++;
  if (point.remembered) { entry.remembered++; return; }
  if (active.view.sees(faction, point.x, point.z)) return;
  if (point.uid !== undefined && active.view.alerted?.(faction, point.uid) === true) { entry.alerted++; return; }
  if (active.view.ruleAllows?.(faction) === true) entry.ruleAllowed++; else entry.unseen++;
};

const SEES_NOTHING: VisionProbeView = { sees: () => false };
const viewOf = (view: VisionProbeView | VisionSees): VisionProbeView =>
  typeof view === "function" ? { sees: view } : view;

/**
 * Installs (or with null removes) the probe over a vision layer's `sees`; "latest" follows the layer of
 * the simulation created last (a harness that builds its simulation internally).
 */
export const setVisionProbe = (view: VisionProbeView | VisionSees | "latest" | null) => {
  if (view === null) { probe = null; return; }
  const followsLatest = view === "latest";
  probe = { followsLatest, sites: new Map(), view: followsLatest ? SEES_NOTHING : viewOf(view) };
};

/** A new simulation offers its layer and alerts; only a probe following the latest simulation takes them. */
export const offerVisionToProbe = (view: VisionProbeView) => {
  if (probe?.followsLatest) probe.view = view;
};

export const isVisionProbeActive = () => probe !== null;

/** One read of an enemy position by `faction` at an instrumented site. */
export const probeUnitRead = (site: string, faction: number, point: VisionProbePoint) => {
  if (probe === null) return;
  record(probe, siteOf(probe, site), faction, point);
};

/**
 * Wraps a spatial query's accept predicate: every accepted enemy is a read. Without a probe the
 * predicate itself comes back, so normal play pays one null check per query and no closure.
 */
export const probeAccept = <Entry extends VisionProbePoint>(
  site: string, faction: number, accept: (entry: Entry) => boolean
) => {
  if (probe === null) return accept;
  const active = probe, entry = siteOf(active, site);
  return (candidate: Entry) => {
    const accepted = accept(candidate);
    if (accepted) record(active, entry, faction, candidate);
    return accepted;
  };
};

/** The sites reported so far, most unseen reads first. */
export const visionProbeReport = () => [...(probe?.sites.values() ?? [])]
  .map(entry => ({ ...entry }))
  .sort((a, b) => b.unseen - a.unseen || b.reads - a.reads || a.site.localeCompare(b.site));

/**
 * One read of an enemy building by `faction` (A14-4b): a site in the faction's known-sites ledger (`recorded`) or
 * known from the start (owner Q3) is a remembered place; any other must be in sight now, else it is unseen.
 */
export const probeSiteRead = (
  site: string, faction: number, building: { uid: number; x: number; z: number }, recorded: boolean
) => {
  if (probe === null) return;
  record(probe, siteOf(probe, site), faction, { remembered: recorded, uid: building.uid, x: building.x, z: building.z });
};
