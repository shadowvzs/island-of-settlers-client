import type { Nation } from "../../../../island-of-settlers-shared/src/nations";

/** Every nation (the shared nation list). */
export type WorkerNation = Nation;
export type SettlerNation = "roman" | "viking" | "japanese" | "nubian";
export type BuildingFirstNation = Exclude<WorkerNation, SettlerNation>;

export const isBuildingFirstNation = (nation: WorkerNation): nation is BuildingFirstNation =>
  nation === "indigenous" || nation === "chinese" || nation === "persian" || nation === "maya";

/** Building-first nation: reuse the Roman roster and equipment until its settlers are authored. */
export const settlerNation = (nation: WorkerNation): SettlerNation =>
  isBuildingFirstNation(nation) ? "roman" : nation;
