/**
 * R15a live A/B switch: `globalThis.__treeViews = "off"` draws the possessed far trees with the
 * iso-angle sprites again (same frame, no rebuild); the preset flag `treeViewImpostors` is the
 * permanent rollback. `__treeViewStats` reports the resident atlas once the layer is built;
 * `__treeViewsDrawn` tells whether the last frame drew it (it also needs the iso sprite layer, which
 * keeps the plants and gates the far tier).
 */
export interface TreeViewStats {
  /** Worker bake plus upload, from the first possessed frame to the layer being drawable (ms). */
  readyMs: number;
  atlasHeight: number;
  atlasWidth: number;
  /** GPU bytes of both atlases with their mip chains. */
  bytes: number;
  blocks: number;
  instances: number;
  texelsPerUnit: number;
}

interface TreeViewGlobal {
  __treeViewStats?: TreeViewStats;
  __treeViewsDrawn?: boolean;
  __treeViews?: "off" | "on";
}

export const treeViewsEnabled = () => (globalThis as TreeViewGlobal).__treeViews !== "off";

export const reportTreeViewStats = (stats: TreeViewStats) => {
  (globalThis as TreeViewGlobal).__treeViewStats = stats;
};

/** Called per frame by the vegetation layer; writes only when the state changes. */
export const reportTreeViewsDrawn = (drawn: boolean) => {
  const scope = globalThis as TreeViewGlobal;
  if (scope.__treeViewsDrawn !== drawn) scope.__treeViewsDrawn = drawn;
};
