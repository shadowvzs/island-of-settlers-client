/** Approved source materials: logs bark/cut ends (0/1), boards (0); exclude all transport ties/runners. */
export const looseTimberSourceChunks = <T extends { material: number }>(kind: "logs" | "planks", chunks: readonly T[]) =>
  chunks.filter(chunk => kind === "logs" ? chunk.material < 2 : chunk.material === 0);
