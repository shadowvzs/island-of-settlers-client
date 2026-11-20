/** Event-core band order: the same bands as the fixed tick (docs/archive/offline-catchup/event-driven-core-design-2026-10-22.md). */
export const EVENT_BANDS = {
  postActor: 4,
  runtime: 0,
  scheduler: 2,
  systems: 1,
  actors: 3
} as const;

export type EventBand = (typeof EVENT_BANDS)[keyof typeof EVENT_BANDS];

/** One event in the exact core; the runner maps `kind` and `entity` to a state-machine handler. */
export interface ScheduledEvent {
  band: EventBand;
  entity: string;
  id: string;
  kind: string;
  order: number;
  tick: number;
  version: number;
}

interface QueuedEvent extends ScheduledEvent {
  /** Stable fallback for two events with the same tick, band, order and id. */
  sequence: number;
}

export interface EventQueue {
  clear: () => void;
  peek: () => ScheduledEvent | undefined;
  pop: () => ScheduledEvent | undefined;
  push: (event: ScheduledEvent) => void;
  readonly size: number;
}

const before = (left: QueuedEvent, right: QueuedEvent) => {
  if (left.tick !== right.tick) return left.tick - right.tick;
  if (left.band !== right.band) return left.band - right.band;
  if (left.order !== right.order) return left.order - right.order;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return left.sequence - right.sequence;
};

/**
 * Deterministic binary heap keyed by `(tick, band, order, id, insertion)`. The queue owns no state
 * besides the sequence counter, so two identical runs pop the same events in the same order.
 */
export const createEventQueue = (): EventQueue => {
  const heap: QueuedEvent[] = [];
  let nextSequence = 0;
  const swap = (left: number, right: number) => {
    [heap[left], heap[right]] = [heap[right]!, heap[left]!];
  };
  const rise = (index: number) => {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (before(heap[parent]!, heap[index]!) <= 0) return;
      swap(parent, index);
      index = parent;
    }
  };
  const sink = (index: number) => {
    for (;;) {
      const left = index * 2 + 1, right = left + 1;
      let next = index;
      if (left < heap.length && before(heap[left]!, heap[next]!) < 0) next = left;
      if (right < heap.length && before(heap[right]!, heap[next]!) < 0) next = right;
      if (next === index) return;
      swap(next, index);
      index = next;
    }
  };
  return {
    clear: () => { heap.length = 0; },
    get size() { return heap.length; },
    peek: () => heap[0],
    pop: () => {
      if (!heap.length) return undefined;
      const first = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) { heap[0] = last; sink(0); }
      return first;
    },
    push: event => {
      heap.push({ ...event, sequence: nextSequence++ });
      rise(heap.length - 1);
    }
  };
};
