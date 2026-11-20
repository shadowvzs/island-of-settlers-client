const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const EXTENSION = "EXT_disjoint_timer_query_webgl2";
/** Queries in flight before a pass is left untimed (a stalled GPU must not grow the pool). */
const MAX_PENDING_QUERIES = 512;

/** A finished pass query; `ms` is null when a disjoint event invalidated the result. */
export interface GpuPassResult {
  frame: number;
  ms: number | null;
  slot: number;
}

interface PendingQuery {
  frame: number;
  query: WebGLQuery;
  slot: number;
}

/**
 * Sequential (never nested) TIME_ELAPSED queries with EXT_disjoint_timer_query_webgl2; results
 * arrive a few frames later, tagged with the caller's frame and slot. WebGL2 allows only one open
 * query per target, so callers end one pass before they begin the next. Null when unsupported.
 */
export const createGpuPassTimer = (gl: WebGL2RenderingContext, maxPending = MAX_PENDING_QUERIES) => {
  if (!gl.getExtension(EXTENSION)) return null;
  const pending: PendingQuery[] = [];
  const free: WebGLQuery[] = [];
  let enabled = true;
  let open = false;
  // Queries die with a lost context, and a restored context must enable the extension again.
  gl.canvas.addEventListener("webglcontextlost", () => {
    enabled = false; open = false; pending.length = 0; free.length = 0;
  });
  gl.canvas.addEventListener("webglcontextrestored", () => { enabled = Boolean(gl.getExtension(EXTENSION)); });

  /** False when the pass is not timed (lost context or a full pool): its frame's GPU time is unknown. */
  const begin = (frame: number, slot: number) => {
    if (!enabled || open || pending.length >= maxPending) return false;
    const query = free.pop() ?? gl.createQuery();
    gl.beginQuery(TIME_ELAPSED_EXT, query);
    pending.push({ frame, query, slot });
    open = true;
    return true;
  };

  const end = () => {
    if (!open) return;
    open = false;
    if (enabled) gl.endQuery(TIME_ELAPSED_EXT);
  };

  /** Reports every finished query in order; one disjoint event invalidates the whole batch. */
  const poll = (onResult: (result: GpuPassResult) => void) => {
    if (!enabled || pending.length === 0) return;
    const disjoint = Boolean(gl.getParameter(GPU_DISJOINT_EXT));
    // The open query is the newest one; it never resolves before end().
    const resolvable = open ? pending.length - 1 : pending.length;
    let resolved = 0;
    while (resolved < resolvable) {
      const { frame, query, slot } = pending[resolved]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      onResult({ frame, ms: disjoint ? null : nanoseconds / 1e6, slot });
      free.push(query);
      resolved++;
    }
    if (resolved > 0) pending.splice(0, resolved);
  };

  return { begin, end, poll };
};
export type GpuPassTimer = NonNullable<ReturnType<typeof createGpuPassTimer>>;

/**
 * GPU time per frame (one query around the whole frame). Independent of vsync and rAF scheduling.
 * A query spanning CPU-only work also counts the GPU idle time in between (see R01 receipt).
 */
export const createGpuTimer = (gl: WebGL2RenderingContext) => {
  const timer = createGpuPassTimer(gl);
  if (!timer) return null;
  return {
    begin: () => { timer.begin(0, 0); },
    end: timer.end,
    /** Reports every finished query (skips results invalidated by a disjoint event). */
    poll: (onResult: (milliseconds: number) => void) => timer.poll(({ ms }) => {
      if (ms !== null) onResult(ms);
    })
  };
};
