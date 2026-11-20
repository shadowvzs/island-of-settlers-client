import { captureSeaMaskSource, type SeaMaskSource, seaMaskSourceHolds } from "../world/sea-mask-source";
import type { WorldData } from "../world/world-data";
import { shouldVerifyNavigationReuse } from "./navigation-change-journal";
import { createSeaMask } from "./settlement-sea-navigation";
import type { SettlementContext } from "./settlement-types";

interface DockSea {
  /** Build, terrain and prop revisions the mask was last confirmed at. */
  revision: string;
  sea: Uint8Array;
  source: SeaMaskSource;
}
const dockSeas = new WeakMap<SettlementContext, DockSea>();

const verifyKeptSea = (world: WorldData, sea: Uint8Array) => {
  if (!shouldVerifyNavigationReuse()) return;
  const fresh = createSeaMask(world);
  if (fresh.some((value, cell) => value !== sea[cell])) throw new Error("Stale harbour dock sea mask");
};

const confirmedAt = ({ revision, source }: DockSea, world: WorldData, current: string) =>
  revision === current && source.world === world && source.sourceHeights === world.heights &&
  source.sourceLake === world.lakeWater;

/**
 * The harbour docks' own sea mask. Occupancy/reservation changes invalidate dock paths, but never
 * change the sea flood-fill. Any build, terrain or prop revision (or replaced array) still confirms
 * the mask against the heights it was derived from; when every changed vertex stayed dry
 * (JETTY-FRAMES) the same mask object is kept, so dock geometry cached against it stays reusable.
 */
export const defaultHarbourDockSea = (context: SettlementContext) => {
  const { world } = context.options;
  const revision = [world.buildRevision ?? 0, world.terrainRevision ?? 0, world.props.count,
    world.cellsX, world.cellsZ, world.seaLevel].join(":");
  const known = dockSeas.get(context);
  if (known && confirmedAt(known, world, revision)) return known.sea;
  if (known && known.sea.length === world.cellsX * world.cellsZ && seaMaskSourceHolds(world, known.source)) {
    known.revision = revision;
    verifyKeptSea(world, known.sea);
    return known.sea;
  }
  const sea = createSeaMask(world);
  dockSeas.set(context, { revision, sea, source: captureSeaMaskSource(world) });
  return sea;
};
