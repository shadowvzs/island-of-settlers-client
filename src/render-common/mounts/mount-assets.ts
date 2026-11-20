import type { CoatLuminance } from "@workers/mount-coat-material";

import minimalHorse from "../../../assets/mounts/horse-minimal.glb?url";
import minimalJapaneseRider from "../../../assets/mounts/japanese-rider-minimal.glb?url";
import commanderNubianSurface from "../../../assets/mounts/nubian-commander-surface.glb?url";
import minimalNubianRider from "../../../assets/mounts/nubian-rider-minimal.glb?url";
import minimalRomanRider from "../../../assets/mounts/roman-rider-minimal.glb?url";
import commanderVikingHigh from "../../../assets/mounts/viking-commander-mounted-clean.glb?url";
import commanderVikingSurface from "../../../assets/mounts/viking-commander-mounted-clean-minimal.glb?url";
import minimalVikingRider from "../../../assets/mounts/viking-rider-minimal.glb?url";
import { NATION_RIDERS } from "./nation-riders";

/**
 * Mount asset paths, relative to the mounts folder (`MOUNT_ASSET_BASE`); the bundled Minimal
 * meshes are already full URLs, which resolve to themselves.
 */
export interface MountRiderEntry {
  animations: string;
  model: string;
  nation: string;
  tunicTint: string;
  variant: string;
}

export interface MountManifest {
  horse: { coat: CoatLuminance & { mask: string }; model: string };
  riders: MountRiderEntry[];
}

/** Each nation's Minimal rider: the riding body simplified (asset-tools build-rider-minimal.ts). */
const MINIMAL_RIDERS: Readonly<Record<string, string>> = {
  japanese: minimalJapaneseRider,
  nubian: minimalNubianRider,
  roman: minimalRomanRider,
  viking: minimalVikingRider
};

/** Riding rigs, rather than a new nation's display identity, determine compatible far meshes. */
const MINIMAL_RIDER_VARIANTS: Readonly<Record<string, string>> = {
  "japanese-man-linen": minimalJapaneseRider,
  "nubian-man-kilt": minimalNubianRider,
  "roman-man-white": minimalRomanRider,
  "viking-woman-blue": minimalVikingRider
};

/** Source-preserving near anatomy for the single Commander, not an ordinary rider budget change. */
const COMMANDER_SURFACES: Readonly<Record<string, string>> = {
  "nubian-man-kilt": commanderNubianSurface,
  "viking-woman-blue": commanderVikingSurface
};
export const hasCommanderRiderSurface = (variant: string) => Boolean(COMMANDER_SURFACES[variant]);

/** The repaired mounted garment belongs to the Commander; ordinary cavalry keeps its budget. */
const COMMANDER_HIGH_SURFACES: Readonly<Record<string, string>> = {
  "viking-woman-blue": commanderVikingHigh
};
export const riderModelPath = (entry: MountRiderEntry, commander = false) =>
  commander ? COMMANDER_HIGH_SURFACES[entry.variant] ?? entry.model : entry.model;

/** The baked Minimal horse: the only horse on Minimal, the far-detail horse on High. */
export const MINIMAL_HORSE_PATH: string = minimalHorse;

/** A nation's Minimal rider: the only rider on Minimal, the far-detail rider on High. */
export const minimalRiderPath = (entry: MountRiderEntry, commander = false) => {
  const ordinary = MINIMAL_RIDER_VARIANTS[entry.variant] ?? MINIMAL_RIDERS[entry.nation] ?? minimalRomanRider;
  return commander ? COMMANDER_SURFACES[entry.variant] ?? ordinary : ordinary;
};

/** Every file the cavalry of these nations loads at one detail level (voyage prefetch). */
export const mountAssetPaths = (manifest: MountManifest, nations: ReadonlySet<string>, detailed: boolean) => {
  const variants = new Set(Object.entries(NATION_RIDERS)
    .filter(([nation]) => nations.has(nation)).map(([, variant]) => variant));
  return [
    // High also loads the Minimal meshes as its far detail (mount-detail.ts).
    ...(detailed ? [manifest.horse.model] : []),
    MINIMAL_HORSE_PATH,
    manifest.horse.coat.mask,
    ...manifest.riders
      .filter(entry => nations.has(entry.nation) || variants.has(entry.variant))
      .flatMap(entry => [...(detailed ? [entry.model] : []), minimalRiderPath(entry), entry.animations,
        ...(hasCommanderRiderSurface(entry.variant)
          ? [...(detailed ? [riderModelPath(entry, true)] : []), minimalRiderPath(entry, true)] : [])])
  ];
};
