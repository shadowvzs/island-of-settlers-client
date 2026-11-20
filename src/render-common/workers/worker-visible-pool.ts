import type { WorkerFrame } from "./worker-unit";

interface Member {
  dispose(): void;
  /** C02 (c): detach from the scene while the pool keeps the body for a later re-entry. */
  park?(): void;
  /** Applies a view jump's newly projected detail level at once (C11). */
  refreshDetail?(): void;
  setColor(color: string): void;
  update(frame: WorkerFrame | undefined): void;
}

/** C02 (c): bounds of the parked-member free list, so a busy settlement cannot hoard bodies. */
export const VISIBLE_WORKER_RETAINED_TOTAL = 16;
export const VISIBLE_WORKER_RETAINED_PER_APPEARANCE = 2;

/**
 * Only visible actors own model instances; late loads cannot resurrect stored or removed actors.
 *
 * C02 (c): with `retain`, a body that leaves the visible set is parked (detached, not disposed) in a
 * bounded per-appearance free list and handed to the next actor of the same body type, so a
 * visible:false -> true switch does not clone a body and its materials again. Without `retain` the
 * pool disposes it immediately, the pre-C02 behaviour.
 */
export const createVisibleWorkerPool = <T extends Member>(options: {
  attach(member: T): void;
  load(frame: WorkerFrame): Promise<T>;
  maxRetained?: number;
  maxRetainedPerAppearance?: number;
  onError(error: unknown): void;
  /** Parks a released member for reuse instead of disposing it; enables the free list. */
  retain?(member: T): void;
}) => {
  const members = new Map<number, { appearance: string; member: T }>();
  const pending = new Map<number, { appearance: string; frame: WorkerFrame }>();
  const retained = new Map<string, T[]>();
  const maxRetained = options.maxRetained ?? VISIBLE_WORKER_RETAINED_TOTAL;
  const maxRetainedPerAppearance = options.maxRetainedPerAppearance ?? VISIBLE_WORKER_RETAINED_PER_APPEARANCE;
  const loads = new Set<Promise<void>>();
  let color: string | undefined;
  let hoveredId: number | null = null;
  let retainedCount = 0;
  let disposed = false;
  const identity = (frame: WorkerFrame) => `${frame.nation}/${frame.variant}`;
  const keep = (appearance: string, member: T) => {
    const list = retained.get(appearance);
    if (!options.retain || retainedCount >= maxRetained ||
      (list?.length ?? 0) >= maxRetainedPerAppearance) {
      member.dispose();
      return;
    }
    options.retain(member);
    if (list) list.push(member);
    else retained.set(appearance, [member]);
    retainedCount++;
  };
  const take = (appearance: string) => {
    const list = retained.get(appearance);
    const member = list?.pop();
    if (!member) return undefined;
    retainedCount--;
    if (!list!.length) retained.delete(appearance);
    return member;
  };
  /** A parked body of the same type replaces a clone for a re-entry. */
  const resume = (id: number, appearance: string, frame: WorkerFrame) => {
    const member = take(appearance);
    if (!member) return false;
    // A load still in flight for another appearance of this actor must not overwrite the resume.
    pending.delete(id);
    if (color) member.setColor(color);
    members.set(id, { appearance, member });
    options.attach(member);
    member.update(frame);
    return true;
  };
  const update = (frames: readonly WorkerFrame[] = []) => {
    const active = new Set<number>();
    frames.forEach((frame, index) => {
      if (frame.visible === false) return;
      const id = frame.actorId ?? index;
      active.add(id);
      const appearance = identity(frame);
      const entry = members.get(id);
      if (entry?.appearance === appearance) {
        entry.member.update(frame);
        return;
      }
      if (entry) { entry.member.dispose(); members.delete(id); }
      const request = pending.get(id);
      if (request?.appearance === appearance) { request.frame = frame; return; }
      if (resume(id, appearance, frame)) return;
      const token = { appearance, frame };
      pending.set(id, token);
      const loading = options.load(frame).then(member => {
        if (disposed || pending.get(id) !== token) { member.dispose(); return; }
        pending.delete(id);
        if (color) member.setColor(color);
        members.set(id, { appearance, member });
        options.attach(member);
        member.update(token.frame);
      }).catch(error => {
        if (pending.get(id) !== token) return;
        pending.delete(id);
        if (!disposed) options.onError(error);
      });
      loads.add(loading);
      void loading.finally(() => loads.delete(loading));
    });
    for (const [id, entry] of members) if (!active.has(id)) {
      members.delete(id);
      keep(entry.appearance, entry.member);
    }
    for (const id of pending.keys()) if (!active.has(id)) pending.delete(id);
  };
  return {
    update,
    whenReady: async () => {
      while (loads.size) await Promise.all(loads);
    },
    /**
     * Drops the detail hold of every loaded body, so a camera jump applies its LOD this frame.
     * Parked bodies are included: one resumed after this call must not keep the held level.
     */
    refreshDetail: () => {
      for (const { member } of members.values()) member.refreshDetail?.();
      for (const list of retained.values()) for (const member of list) member.refreshDetail?.();
    },
    setColor: (value: string) => {
      color = value;
      for (const { member } of members.values()) member.setColor(value);
      for (const list of retained.values()) for (const member of list) member.setColor(value);
    },
    /** The worker under the pointer, if it is still loaded and visible. */
    hovered: () => hoveredId === null ? undefined : members.get(hoveredId)?.member,
    get: (id: number) => members.get(id)?.member,
    setHover: (id: number | null) => { hoveredId = id; },
    stats: () => ({ active: members.size, pending: pending.size, retained: retainedCount }),
    dispose: () => {
      disposed = true;
      pending.clear();
      for (const { member } of members.values()) member.dispose();
      members.clear();
      for (const list of retained.values()) for (const member of list) member.dispose();
      retained.clear();
      retainedCount = 0;
    }
  };
};
