import type { SnapshotRowKey } from "../../../../island-of-settlers-shared/src/island-key";
import { islandContentSignature } from "../../../../island-of-settlers-shared/src/island-signature";
import {
  compactIsland, type LiveMap, type MapBase, type MapBases
} from "../../../../island-of-settlers-shared/src/save-map-delta";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { CommandLogInterval } from "../../shared/settlement/command-log";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { profileSaveStage, profileSaveStageAsync } from "../../shared/settlement/save-stage-profile";
import { toSaveSnapshot } from "./save-snapshot";

/**
 * The cloud upload body of one game (research 12 S07, owner 2026-11-07). Every island is encoded once as its
 * compact JSON text and given a content signature (SHA-256 of that text, shared with the server). An island
 * whose signature equals the one the server stores is sent as `{ key, unchanged: signature }` and no bytes.
 * The encoding of an island whose saved content did not change since the last save (same row signature and the
 * same trade lists) is reused, so its map is neither compacted nor serialised again. All of it runs in the save
 * worker; the main thread only passes the capture and receives the compressed body.
 */

/** A map base an island's compaction relied on; the server must hold it unless the upload says it is confirmed. */
interface BaseUse { catalogue: boolean; hash: string; key: string; map?: string }

interface EncodedIsland {
  bases: BaseUse[];
  key: SnapshotRowKey;
  metadataJson: string;
  schemaVersion: number;
  signature: string;
  text: string;
}

interface CachedIsland extends EncodedIsland {
  rowSignature: string;
  /** The island's trade lists as JSON: they live in other rows, so the row signature does not cover them. */
  trade: string;
}

/** A base of an upload: its bytes, or (published catalogue revision) only its hash for the server to pin. */
type UploadedBase = { catalogue: true; hash: string; key: string } | { hash: string; key: string; map: string };

/** The compressed body and the content signature of every island it describes (what the server will hold). */
export interface SnapshotUpload { body: ArrayBuffer; signatures: Record<string, string> }

export interface SnapshotBodyInputs {
  bases?: MapBases;
  commandLogs?: readonly CommandLogInterval[];
  /** Hashes of bases the server confirmed: they are not uploaded again. */
  confirmed?: readonly string[];
  game: GameSaveV1;
  /** The save on screen's map parts: an island or the campaign run row (both keyed like their snapshot row). */
  live?: { islandKey: SnapshotRowKey; map: LiveMap };
  /** Row signatures of the islands the save wrote (not live ones): they key the encoding cache. */
  rowSignatures?: ReadonlyMap<SnapshotRowKey, string>;
  /** Content signatures of the islands the server stores (from its last read or upload answer). */
  serverSignatures?: Readonly<Record<string, string>>;
}

const baseUse = (key: string, base: MapBase, preferredHash?: string): BaseUse =>
  base.hash === preferredHash
    ? { catalogue: true, hash: base.hash, key }
    : { catalogue: false, hash: base.hash, key, map: base.map };

/** Compacts one island against `bases`, noting every base it used (the server pins or stores them). */
const compactTracked = async (
  data: Record<string, unknown>, key: SnapshotRowKey, bases: MapBases | undefined, live: LiveMap | undefined
) => {
  const uses: BaseUse[] = [];
  if (!bases) return { data, uses };
  const tracked: MapBases = { ...bases,
    find: async (baseKey, preferredHash) => {
      const base = await bases.find(baseKey, preferredHash);
      if (base) uses.push(baseUse(baseKey, base, preferredHash));
      return base;
    },
    write: async (baseKey, base) => {
      await bases.write(baseKey, base);
      uses.push({ catalogue: false, hash: base.hash, key: baseKey, map: base.map });
    } };
  return { data: await compactIsland(data, key, tracked, live), uses };
};

const tradeJson = (data: Record<string, unknown>) =>
  JSON.stringify((data.settlement as { trade?: unknown } | undefined)?.trade ?? null);

const encodeIsland = async (
  island: ReturnType<typeof toSaveSnapshot>["islands"][number], bases: MapBases | undefined, live: LiveMap | undefined
): Promise<EncodedIsland> => {
  const { data, uses } = await compactTracked(island.save.data, island.key, bases, live);
  const text = JSON.stringify(data), metadataJson = JSON.stringify(island.save.metadata);
  return { bases: uses, key: island.key, metadataJson, schemaVersion: island.save.schemaVersion, text,
    signature: await islandContentSignature(island.save.schemaVersion, metadataJson, text) };
};

const referenceText = (island: EncodedIsland) =>
  `{"key":${JSON.stringify(island.key)},"unchanged":"${island.signature}"}`;

const completeText = (island: EncodedIsland) =>
  `{"key":${JSON.stringify(island.key)},"save":{"schemaVersion":${island.schemaVersion},` +
  `"metadata":${island.metadataJson},"data":${island.text}}}`;

/** The bases the complete islands rely on that the server does not hold yet: bytes, or the catalogue hash. */
const uploadedBases = async (
  islands: readonly EncodedIsland[], bases: MapBases | undefined, confirmed: readonly string[]
) => {
  const seen = new Set(confirmed), uploaded: UploadedBase[] = [];
  for (const use of islands.flatMap(island => island.bases)) {
    if (seen.has(use.hash)) continue;
    seen.add(use.hash);
    if (use.catalogue) { uploaded.push({ catalogue: true, hash: use.hash, key: use.key }); continue; }
    const map = use.map ?? await bases?.read(use.hash);
    if (!map) throw new Error("A map base of the upload is no longer stored");
    uploaded.push({ hash: use.hash, key: use.key, map });
  }
  return uploaded;
};

const gzipText = async (text: string) => profileSaveStageAsync("save.encode.gzip", async () =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());

/**
 * The upload body of a slot without a home between two campaign maps (ONLINE-STORY): no island row, only the
 * player's progress and an empty session. The server stores it only for a slot whose rules have no home island.
 */
export const encodeStoryProgressBody = (player: PlayerProgress, savedAt: number) =>
  gzipText(JSON.stringify({ adventures: [], colonies: [], evacuations: [], islands: [], player,
    session: { active: null, savedAt } }));

interface Described { complete: ReadonlySet<string>; islands: readonly EncodedIsland[] }

/** Builds the body text: the islands as references or complete documents, the rest of the snapshot as JSON. */
const bodyText = async (
  described: Described, rest: object, bases: MapBases | undefined, confirmed: readonly string[]
) => {
  const sent = described.islands.filter(island => described.complete.has(island.key));
  const mapBases = bases ? { mapBases: await uploadedBases(sent, bases, confirmed) } : {};
  const head = JSON.stringify({ islands: [], ...rest, ...mapBases });
  const parts = described.islands.map(island =>
    described.complete.has(island.key) ? completeText(island) : referenceText(island));
  return `{"islands":[${parts.join(",")}${head.slice('{"islands":['.length)}`;
};

const signaturesOf = (islands: readonly EncodedIsland[]) =>
  Object.fromEntries(islands.map(island => [island.key, island.signature]));

/**
 * One builder per cloud slot (it lives in the save worker): it remembers the encodings of unchanged islands and
 * the last body's parts, so `complete` can answer a server request for islands it did not hold.
 */
export const createSnapshotBodyBuilder = () => {
  const cache = new Map<SnapshotRowKey, CachedIsland>();
  let last: { bases?: MapBases; confirmed: readonly string[]; described: Described; rest: object } | undefined;

  const reusable = (key: SnapshotRowKey, rowSignature: string | undefined, trade: string) => {
    const cached = cache.get(key);
    return cached && rowSignature === cached.rowSignature && trade === cached.trade ? cached : undefined;
  };

  const encodeAll = async (inputs: SnapshotBodyInputs, snapshot: ReturnType<typeof toSaveSnapshot>) => {
    const islands: EncodedIsland[] = [];
    for (const island of snapshot.islands) {
      const rowSignature = inputs.rowSignatures?.get(island.key), trade = tradeJson(island.save.data);
      const kept = reusable(island.key, rowSignature, trade);
      if (kept) { islands.push(kept); continue; }
      const live = island.key === inputs.live?.islandKey ? inputs.live.map : undefined;
      const encoded = await encodeIsland(island, inputs.bases, live);
      islands.push(encoded);
      if (rowSignature && !live) cache.set(island.key, { ...encoded, rowSignature, trade });
      else cache.delete(island.key);
    }
    for (const key of [...cache.keys()]) if (!islands.some(island => island.key === key)) cache.delete(key);
    return islands;
  };

  const finish = async (
    described: Described, rest: object, bases: MapBases | undefined, confirmed: readonly string[]
  ) => {
    const text = await profileSaveStageAsync("save.encode.serialize",
      () => bodyText(described, rest, bases, confirmed));
    // Base bytes are read again from the browser database if a later body needs them.
    for (const island of described.islands) for (const use of island.bases) delete use.map;
    last = { bases, confirmed, described, rest };
    return { body: await gzipText(text), signatures: signaturesOf(described.islands) };
  };

  return {
    /** The upload body for `inputs`; islands the server already holds (by signature) travel as references. */
    build: async (inputs: SnapshotBodyInputs): Promise<SnapshotUpload> =>
      profileSaveStageAsync("save.encode", async () => {
        const snapshot = profileSaveStage("save.encode.snapshot", () => toSaveSnapshot(inputs.game));
        const islands = await profileSaveStageAsync("save.encode.compact", () => encodeAll(inputs, snapshot));
        const { islands: _islands, ...others } = snapshot;
        const rest = { ...others, ...inputs.commandLogs?.length ? { commandLogs: inputs.commandLogs } : {} };
        const server = inputs.serverSignatures ?? {};
        const changed = islands.filter(island => server[island.key] !== island.signature);
        const complete = new Set(changed.map(island => island.key));
        return finish({ complete, islands }, rest, inputs.bases, inputs.confirmed ?? []);
      }),
    /** The last body again with these islands (and only these more) sent complete. */
    complete: async (keys: readonly string[]): Promise<SnapshotUpload> => {
      if (!last) throw new Error("No snapshot body to complete");
      const complete = new Set([...last.described.complete, ...keys]);
      return finish({ complete, islands: last.described.islands }, last.rest, last.bases, last.confirmed);
    },
    /** Forgets every cached encoding (the slot's local copy was cleared). */
    reset: () => { cache.clear(); last = undefined; }
  };
};

export type SnapshotBodyBuilder = ReturnType<typeof createSnapshotBodyBuilder>;
