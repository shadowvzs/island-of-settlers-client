/**
 * Order of the visible culling chunks inside one instance buffer. A view change keeps the leading
 * chunks that stay visible and rewrites only the part from the first leaving (or edited) chunk on, so
 * a zoom or pan uploads the changed edge instead of the whole buffer. The rewritten tail is ordered
 * centre-out (distance to the visible chunks' centroid): the chunks that leave first on the next zoom
 * or pan are the ones at the end, which then costs nothing but a smaller instance count.
 */
export interface PropChunkLayout {
  /** Instances in the buffer. */
  count: number;
  /** Chunks whose instances changed since they were written (rewritten on the next layout). */
  dirty: Set<number>;
  /** First instance of every laid out chunk. */
  offsets: Map<number, number>;
  /** Laid out chunks in buffer order. */
  order: number[];
}

/** The part of the buffer a layout pass rewrites. */
export interface PropChunkRewrite {
  /** Index in `order` of the first rewritten chunk. */
  fromIndex: number;
  /** First rewritten instance. */
  fromOffset: number;
}

export const createPropChunkLayout = (): PropChunkLayout => ({
  count: 0,
  dirty: new Set(),
  offsets: new Map(),
  order: []
});

/** Forgets the buffer contents (new or reallocated buffers): the next pass writes every chunk. */
export const resetPropChunkLayout = (layout: PropChunkLayout) => {
  layout.count = 0;
  layout.dirty.clear();
  layout.offsets.clear();
  layout.order.length = 0;
};

const findFirstStale = (
  layout: PropChunkLayout,
  visible: Uint8Array,
  countOf: (chunk: number) => number
) => {
  const { dirty, order } = layout;
  for (let index = 0; index < order.length; index++) {
    const chunk = order[index]!;
    if (!visible[chunk] || dirty.has(chunk) || countOf(chunk) === 0) return index;
  }
  return order.length;
};

/** Squared chunk-grid distance of every candidate to the centroid of the visible candidates. */
const rankCentreOut = (chunks: number[], chunksX: number) => {
  let sumX = 0;
  let sumZ = 0;
  for (const chunk of chunks) {
    sumX += chunk % chunksX;
    sumZ += Math.floor(chunk / chunksX);
  }
  const centreX = sumX / Math.max(1, chunks.length);
  const centreZ = sumZ / Math.max(1, chunks.length);
  const rank = new Map<number, number>();
  for (const chunk of chunks)
    rank.set(chunk, (chunk % chunksX - centreX) ** 2 + (Math.floor(chunk / chunksX) - centreZ) ** 2);
  return rank;
};

/**
 * Plans the next buffer order for `visible` and returns the rewritten part; `layout` is updated
 * (order, offsets, count, dirty cleared). `chunks` lists every chunk holding instances.
 */
export const planPropChunkLayout = (
  layout: PropChunkLayout,
  chunks: Iterable<number>,
  visible: Uint8Array,
  countOf: (chunk: number) => number,
  chunksX: number
): PropChunkRewrite => {
  const fromIndex = findFirstStale(layout, visible, countOf);
  const kept = layout.order.slice(0, fromIndex);
  const keptSet = new Set(kept);
  const visibleChunks: number[] = [];
  const tail: number[] = [];
  for (const chunk of chunks) {
    if (!visible[chunk] || countOf(chunk) === 0) continue;
    visibleChunks.push(chunk);
    if (!keptSet.has(chunk)) tail.push(chunk);
  }
  const rank = rankCentreOut(visibleChunks, chunksX);
  tail.sort((first, second) => rank.get(first)! - rank.get(second)! || first - second);
  const fromOffset = fromIndex < layout.order.length
    ? layout.offsets.get(layout.order[fromIndex]!)!
    : layout.count;
  for (const chunk of layout.order.slice(fromIndex)) layout.offsets.delete(chunk);
  let offset = fromOffset;
  for (const chunk of tail) {
    layout.offsets.set(chunk, offset);
    offset += countOf(chunk);
  }
  layout.order = kept.concat(tail);
  layout.count = offset;
  layout.dirty.clear();
  return { fromIndex, fromOffset };
};
