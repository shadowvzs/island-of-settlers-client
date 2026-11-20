import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { entriesOfKind } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { TRIPO_ROSTER } from "../../island-of-settlers-worker-generation/src/tripo-roster";
import { workerBodyNation } from "../src/render-common/workers/worker-body-nation";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { CATALOG_ASSET_ROOTS } from "../tools/assets/catalog-asset-files";

interface WorkerRecord { animations: string; model: string; modelMinimal?: string; nation: string; variant: string }
interface ArmourBody { files: Record<string, string>; id: string; models: Record<string, string> }
interface ArmourSet { bodies: ArmourBody[]; nation: string }

const workerRoot = CATALOG_ASSET_ROOTS.workerRepo;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(workerRoot, path), "utf8")) as T;

/**
 * The worker repository's published manifests against the roster, for every catalog nation's body nation (formerly
 * checked by the deleted `tools/assets/nation-catalog.ts`): each roster variant has its civilian body and an
 * armour body, and every file they name exists.
 */
describe("worker manifests match the roster", () => {
  const workers = readJson<{ workers: WorkerRecord[] }>("tripo/manifest.json").workers;
  const armour = readJson<{ sets: ArmourSet[] }>("armour/manifest.json").sets;
  const bodyNations = [...new Set(entriesOfKind("nation").map(entry => workerBodyNation(entry.key as WorkerNation)))];

  it.each(bodyNations)("%s bodies and armour sets are complete", nation => {
    const roster = [...TRIPO_ROSTER[nation].female, ...TRIPO_ROSTER[nation].male];
    const records = workers.filter(worker => worker.nation === nation);
    expect(records.map(worker => worker.variant).sort()).toEqual([...roster].sort());
    const set = armour.find(candidate => candidate.nation === nation);
    expect(set, `${nation} armour set`).toBeDefined();
    const missing: string[] = [];
    for (const worker of records) {
      const body = set!.bodies.find(candidate => candidate.id === worker.variant);
      if (!body) { missing.push(`armour body ${worker.variant}`); continue; }
      const tripo = [worker.model, worker.animations, worker.modelMinimal].filter((path): path is string => !!path);
      const files = [...tripo.map(path => join("tripo", path)),
        ...[...Object.values(body.models), ...Object.values(body.files)].map(path => join("armour", path))];
      missing.push(...files.filter(path => !existsSync(join(workerRoot, path))));
    }
    expect(missing).toEqual([]);
  });
});
