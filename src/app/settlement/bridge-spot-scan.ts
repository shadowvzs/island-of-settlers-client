import type { BridgePreview } from "../../shared/settlement/bridge-construction-runtime";
import {
  type BridgeSpot,
  bridgeSpotPointers,
  createBridgeSpotCollector,
  nearestBridgeSpot
} from "../../shared/settlement/bridge-spots";
import type { BridgeKind, RoadPoint } from "../../shared/settlement/road-types";
import type { WorldData } from "../../shared/world/world-data";

export interface BridgeSpotScanOptions {
  /** Clock for the per-frame budget (tests inject a fake). */
  now?: () => number;
  /** Owned territory cells (undefined: the whole island). */
  owned: () => Uint8Array | undefined;
  /** The authoritative bridge preview of the simulation. */
  preview: (pointer: RoadPoint, kind: BridgeKind) => BridgePreview;
  world: WorldData;
}

interface Scan {
  collector: ReturnType<typeof createBridgeSpotCollector>;
  key: string;
  kind: BridgeKind;
  next: number;
  pointers: RoadPoint[];
}

/**
 * Valid bridge crossings of the territory for the placement overlay, scanned time sliced like the
 * building fit spots: once per placement key (territory, roads, buildings, bridge sites, terrain),
 * nearest the camera first, never per frame. A rescan keeps showing the previous spots until done.
 */
export const createBridgeSpotScan = (options: BridgeSpotScanOptions) => {
  const now = options.now ?? (() => performance.now());
  let active: Scan | null = null, shown: Scan | null = null;

  const start = (kind: BridgeKind, key: string, focus: RoadPoint): Scan => ({
    collector: createBridgeSpotCollector(),
    key,
    kind,
    next: 0,
    pointers: bridgeSpotPointers(options.world, options.owned(), focus)
  });

  const advance = (scan: Scan, budgetMs: number) => {
    const deadline = now() + budgetMs;
    while (scan.next < scan.pointers.length) {
      const pointer = scan.pointers[scan.next++]!;
      scan.collector.add(pointer, options.preview(pointer, scan.kind));
      // A preview may route over the road graph: read the clock after each one.
      if (now() >= deadline) break;
    }
  };

  const isDone = (scan: Scan) => scan.next >= scan.pointers.length;

  /** Advances the scan for the active bridge tool (null: tool off); call once per frame. */
  const update = (kind: BridgeKind | null, key: string, focus: RoadPoint, budgetMs = 2) => {
    if (!kind) { active = null; shown = null; return; }
    const fullKey = `${kind}/${key}`;
    if (!shown || shown.kind !== kind) active = shown = start(kind, fullKey, focus);
    else if ((!active || isDone(active)) && shown.key !== fullKey && active?.key !== fullKey)
      active = start(kind, fullKey, focus);
    if (!active || isDone(active)) return;
    advance(active, budgetMs);
    if (active !== shown && isDone(active)) shown = active;
  };

  const spots = (): readonly BridgeSpot[] => shown?.collector.spots() ?? [];
  return {
    isScanning: () => !!active && !isDone(active),
    nearest: (point: RoadPoint) => nearestBridgeSpot(spots(), point),
    spots,
    update
  };
};
