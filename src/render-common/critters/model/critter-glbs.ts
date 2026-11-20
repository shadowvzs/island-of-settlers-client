import bearGlb from "../../../../assets/models/critters/bear/bear.glb?url";
import boarGlb from "../../../../assets/models/critters/boar/boar.glb?url";
import pigletGlb from "../../../../assets/models/critters/boar/piglet.glb?url";
import chamoisGlb from "../../../../assets/models/critters/chamois/chamois.glb?url";
import eagleGlb from "../../../../assets/models/critters/eagle/eagle.glb?url";
import foxGlb from "../../../../assets/models/critters/fox/fox.glb?url";
import heronGlb from "../../../../assets/models/critters/heron/heron.glb?url";
import mallardGlb from "../../../../assets/models/critters/mallard/mallard.glb?url";
import sealGlb from "../../../../assets/models/critters/seal/seal.glb?url";
import squirrelGlb from "../../../../assets/models/critters/squirrel/squirrel.glb?url";
import wolfGlb from "../../../../assets/models/critters/wolf/wolf.glb?url";
import { type GlbFile, readGlb } from "../../glb-reader";

/**
 * The shipped critter GLBs as static asset URLs (cacheable files, never inlined into the JS). A
 * species' models are built only after its files are loaded (`loadCritterGlb`), so an island
 * fetches only the species it spawns.
 */
export const CRITTER_GLB = {
  bear: bearGlb,
  boar: boarGlb,
  chamois: chamoisGlb,
  eagle: eagleGlb,
  fox: foxGlb,
  heron: heronGlb,
  mallard: mallardGlb,
  piglet: pigletGlb,
  seal: sealGlb,
  squirrel: squirrelGlb,
  wolf: wolfGlb
} as const;

/** Fetches a GLB's bytes (tests read them from disk instead). */
export type CritterGlbFetch = (url: string) => Promise<ArrayBuffer>;

const files = new Map<string, GlbFile>();
const pending = new Map<string, Promise<boolean>>();
/** Files that failed once: never fetched again this session (warned once). */
const failed = new Set<string>();

const fetchGlbBytes: CritterGlbFetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
};

const fetchAndRead = async (url: string, fetchGlb: CritterGlbFetch) => {
  try {
    files.set(url, readGlb(await fetchGlb(url)));
    return true;
  } catch (error) {
    failed.add(url);
    console.warn(`Critter model ${url} failed to load; its species is not drawn.`, error);
    return false;
  } finally {
    pending.delete(url);
  }
};

/** Loads a critter GLB once; false (after one warning) when it cannot be fetched or read. */
export const loadCritterGlb = (url: string, fetchGlb: CritterGlbFetch = fetchGlbBytes): Promise<boolean> => {
  if (files.has(url)) return Promise.resolve(true);
  if (failed.has(url)) return Promise.resolve(false);
  const running = pending.get(url);
  if (running) return running;
  const load = fetchAndRead(url, fetchGlb);
  pending.set(url, load);
  return load;
};

export const isCritterGlbLoaded = (url: string) => files.has(url);

/** A loaded critter GLB (the model builders run only after `loadCritterGlb` succeeded). */
export const getCritterGlb = (url: string): GlbFile => {
  const file = files.get(url);
  if (!file) throw new Error(`Critter model ${url} is not loaded`);
  return file;
};
