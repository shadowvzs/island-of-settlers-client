import type { StatefulRandom } from "../world/rng";

/**
 * The seeded streams whose draws change simulated state; their states are saved with their owners. Visual
 * randomness (leaf bursts, ear flicks, critters, appearances) uses streams of its own outside this facade.
 */
export type SimulationStream = "felling" | "forester" | "military" | "wildlife";

/** Draws kept per island: enough to diff the last few ticks of two runs. */
export const RANDOM_AUDIT_SIZE = 1024;

const UNTAGGED = "untagged";

/** A seeded simulation stream: every draw is recorded with the call site and entity set by `at`. */
export interface AuditedRandom {
  (): number;
  /** Tags the following draws with their call site and entity id (no allocation); returns this stream. */
  at: (site: string, entity: number) => AuditedRandom;
  getState: () => number;
  setState: (state: number) => void;
  readonly stream: SimulationStream;
}

/** One recorded draw: `sequence` counts draws since the island's last load, so two runs align by it. */
export interface RandomDraw {
  entity: number;
  sequence: number;
  site: string;
  state: number;
  stream: SimulationStream;
  tick: number;
}

interface DrawSink { record: (stream: SimulationStream, site: string, entity: number, state: number) => void }
interface StreamLink { sink: DrawSink | null }

const links = new WeakMap<AuditedRandom, StreamLink>();

/** Wraps a stateful generator; draws are recorded once the stream is attached to an island's audit. */
export const auditRandom = (stream: SimulationStream, source: StatefulRandom): AuditedRandom => {
  const link: StreamLink = { sink: null };
  let site = UNTAGGED, entity = -1;
  const random = (() => {
    const value = source();
    link.sink?.record(stream, site, entity, source.getState());
    return value;
  }) as AuditedRandom;
  const audited = Object.assign(random, {
    at: (nextSite: string, nextEntity: number) => {
      site = nextSite;
      entity = nextEntity;
      return audited;
    },
    getState: source.getState,
    setState: source.setState,
    stream
  });
  links.set(audited, link);
  return audited;
};

/** A plain function as a stream without saved state (tests that script their rolls). */
export const scriptedRandom = (stream: SimulationStream, draw: () => number) =>
  auditRandom(stream, Object.assign(() => draw(), { getState: () => 0, setState: () => undefined }));

/** One island's draw log (not saved) and the states of its attached streams (the counter checksum's input). */
export const createRandomAudit = () => {
  const ticks = new Float64Array(RANDOM_AUDIT_SIZE), entities = new Float64Array(RANDOM_AUDIT_SIZE);
  const states = new Float64Array(RANDOM_AUDIT_SIZE), sequences = new Float64Array(RANDOM_AUDIT_SIZE);
  const sites: string[] = new Array<string>(RANDOM_AUDIT_SIZE).fill(UNTAGGED);
  const streamNames: SimulationStream[] = new Array<SimulationStream>(RANDOM_AUDIT_SIZE).fill("military");
  const streams: AuditedRandom[] = [];
  let tick = 0, sequence = 0;
  const sink: DrawSink = {
    record: (stream, site, entity, state) => {
      const slot = sequence % RANDOM_AUDIT_SIZE;
      ticks[slot] = tick; entities[slot] = entity; states[slot] = state; sequences[slot] = sequence;
      sites[slot] = site; streamNames[slot] = stream;
      sequence++;
    }
  };
  const drawAt = (slot: number): RandomDraw => ({ entity: entities[slot]!, sequence: sequences[slot]!,
    site: sites[slot]!, state: states[slot]!, stream: streamNames[slot]!, tick: ticks[slot]! });
  return {
    /** Routes these streams' draws into this audit (a stream belongs to one island at a time). */
    attach: (attached: readonly AuditedRandom[]) => {
      for (const stream of attached) {
        const link = links.get(stream);
        if (!link) throw new Error(`Stream ${stream.stream} is not audited`);
        link.sink = sink;
        if (!streams.includes(stream)) streams.push(stream);
      }
      streams.sort((a, b) => a.stream < b.stream ? -1 : 1);
    },
    /** The kept draws, oldest first. */
    draws: (): RandomDraw[] => {
      const count = Math.min(sequence, RANDOM_AUDIT_SIZE), first = sequence - count, result: RandomDraw[] = [];
      for (let index = first; index < sequence; index++) result.push(drawAt(index % RANDOM_AUDIT_SIZE));
      return result;
    },
    /** Draws since the last load. */
    drawCount: () => sequence,
    /** A load starts a new trail: the server's replay of an interval starts from the same snapshot. */
    reset: () => { sequence = 0; },
    /** The island tick the following draws belong to. */
    setTick: (next: number) => { tick = next; },
    /** Each attached stream's state, by stream name (fixed order for checksums). */
    states: (): [SimulationStream, number][] => streams.map((stream): [SimulationStream, number] =>
      [stream.stream, stream.getState()])
  };
};

export type RandomAudit = ReturnType<typeof createRandomAudit>;

const sameDraw = (left: RandomDraw, right: RandomDraw) => left.stream === right.stream && left.site === right.site &&
  left.entity === right.entity && left.state === right.state && left.tick === right.tick;

export interface RandomDrawDifference { actual?: RandomDraw; expected?: RandomDraw; sequence: number }

/**
 * The first draw where two trails of the same interval differ, aligned by sequence (both count from the
 * interval's base snapshot); null when the overlapping draws agree.
 */
export const firstDifferentDraw = (
  expected: readonly RandomDraw[], actual: readonly RandomDraw[]
): RandomDrawDifference | null => {
  const bySequence = new Map(actual.map(draw => [draw.sequence, draw]));
  const firstActual = actual[0]?.sequence ?? Infinity, lastActual = actual.at(-1)?.sequence ?? -1;
  for (const draw of expected) {
    if (draw.sequence < firstActual || draw.sequence > lastActual) continue;
    const other = bySequence.get(draw.sequence);
    if (!other || !sameDraw(draw, other)) return { actual: other, expected: draw, sequence: draw.sequence };
  }
  const lastExpected = expected.at(-1)?.sequence ?? -1;
  if (lastExpected === lastActual) return null;
  // One run drew more: the first draw past the shorter trail.
  const sequence = Math.min(lastExpected, lastActual) + 1;
  return { actual: bySequence.get(sequence), expected: expected.find(draw => draw.sequence === sequence), sequence };
};
