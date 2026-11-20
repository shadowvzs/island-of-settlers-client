/** The subset of a CDP `Profiler.Profile` the summary reads. */
interface CpuProfileNode {
  callFrame: { functionName: string; lineNumber: number; url: string };
  children?: number[];
  id: number;
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

interface ProfileRow {
  ms: number;
  name: string;
}

const IGNORED = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"]);
const TOP_ROWS = 60;

const moduleOf = (url: string) => {
  const path = url.split("?")[0] ?? "";
  return path.slice(path.lastIndexOf("/") + 1) || "(native)";
};

const keyOf = (node: CpuProfileNode) =>
  `${node.callFrame.functionName || "(anonymous)"} ${moduleOf(node.callFrame.url)}:${node.callFrame.lineNumber}`;

const sortedRows = (values: Map<string, number>, limit = TOP_ROWS): ProfileRow[] => [...values]
  .map(([name, ms]) => ({ ms: Math.round(ms * 100) / 100, name }))
  .sort((a, b) => b.ms - a.ms)
  .slice(0, limit);

const addTo = (values: Map<string, number>, key: string, ms: number) =>
  values.set(key, (values.get(key) ?? 0) + ms);

/** Each node's parent, so a sample can be walked up to its root. */
const parentsOf = (nodes: readonly CpuProfileNode[]) => {
  const parents = new Map<number, CpuProfileNode>();
  for (const node of nodes) for (const child of node.children ?? []) parents.set(child, node);
  return parents;
};

/**
 * Self and inclusive milliseconds per function and self milliseconds per module of a sampled CDP
 * profile, normalised to one second of wall time (`perSecond`) so runs of different lengths compare.
 */
export const summarizeCpuProfile = (profile: CpuProfile, wallMs: number) => {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = parentsOf(profile.nodes);
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const modules = new Map<string, number>();
  let busyMs = 0;
  for (const [index, id] of samples.entries()) {
    const ms = (deltas[index + 1] ?? deltas[index] ?? 0) / 1000;
    const leaf = byId.get(id);
    if (leaf === undefined || IGNORED.has(leaf.callFrame.functionName)) continue;
    busyMs += ms;
    addTo(self, keyOf(leaf), ms);
    addTo(modules, moduleOf(leaf.callFrame.url), ms);
    const seen = new Set<string>();
    for (let node: CpuProfileNode | undefined = leaf; node !== undefined; node = parents.get(node.id)) {
      const key = keyOf(node);
      if (seen.has(key) || IGNORED.has(node.callFrame.functionName)) continue;
      seen.add(key);
      addTo(inclusive, key, ms);
    }
  }
  const perSecond = 1000 / Math.max(1, wallMs);
  const scale = (values: Map<string, number>) =>
    new Map([...values].map(([key, ms]) => [key, ms * perSecond]));
  return {
    busyMsPerSecond: Math.round(busyMs * perSecond * 100) / 100,
    inclusive: sortedRows(scale(inclusive), 120),
    modules: sortedRows(scale(modules)),
    self: sortedRows(scale(self))
  };
};
