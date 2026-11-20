import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
buildFixture,
  buildFixtureRecord,   EXPECTED_OWNER_SHA256, FIXTURE_COUNTS, FIXTURE_MAP_SIZE, FIXTURE_SEED, type FixtureManifest, type FixtureRecord,
loadSaveFile,   type OwnerBaselineRecord,
sha256} from "./home-map-island-fixture-lib";

const DEFAULT_OUTPUT = resolve("../resources/project-reviews/home-island-2026-10-27");
const OWNER_SOURCE_LABEL = "resources/offline-economy/owner-2026-10-25-v2/input.json";
const DEFAULT_OWNER_SOURCE = resolve("../", OWNER_SOURCE_LABEL);
const OWNER_COPY_PATH = "owner/two-landmass-owner-baseline.json";
const GENERATED_BY = "island-of-settlers-client/tools/bench/home-map-island-fixtures.ts";

const usage = `Usage:
  npx tsx tools/bench/home-map-island-fixtures.ts generate [--output DIR] [--owner-source FILE] [--skip-owner]
  npx tsx tools/bench/home-map-island-fixtures.ts validate [--output DIR]
  npx tsx tools/bench/home-map-island-fixtures.ts inspect <save.json> [...]

generate writes deterministic 2/5/9-landmass saves at 256x256, copies the immutable
two-landmass owner baseline and writes manifest.json. validate regenerates every fixture
and compares its summary and SHA-256. inspect prints a save's landmass, settlement and
road-network summary.`;

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

const isMissing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const assertSummary = (label: string, actual: unknown, expected: unknown) => {
  if (isDeepStrictEqual(actual, expected)) return;
  throw new Error(`${label}: regenerated or stored summary differs from the manifest`);
};

const captureOwnerBaseline = async (
  sourcePath: string, sourceLabel: string, outputDirectory: string
): Promise<OwnerBaselineRecord | null> => {
  let source: Buffer;
  try {
    source = await readFile(sourcePath);
  } catch (error) {
    if (isMissing(error)) {
      console.warn(`Owner save not found at ${sourceLabel}; generated fixtures only.`);
      return null;
    }
    throw error;
  }
  const sourceHash = sha256(source);
  if (sourceHash !== EXPECTED_OWNER_SHA256)
    throw new Error(`Owner save hash ${sourceHash} does not match the frozen baseline ${EXPECTED_OWNER_SHA256}`);
  const destination = resolve(outputDirectory, OWNER_COPY_PATH);
  await mkdir(resolve(outputDirectory, "owner"), { recursive: true });
  try {
    await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const copy = await readFile(destination);
  if (sha256(copy) !== sourceHash)
    throw new Error(`Immutable owner baseline copy ${OWNER_COPY_PATH} was modified`);
  await chmod(destination, 0o444);
  const loaded = await loadSaveFile(destination);
  if (loaded.summary.world.landmassCount !== 2)
    throw new Error(`Owner baseline has ${loaded.summary.world.landmassCount} landmasses, expected 2`);
  return {
    originalExport: "island-settlers-2026-10-25 (2).json (owner export, not modified)",
    origin: "owner-save",
    path: OWNER_COPY_PATH,
    sha256: sourceHash,
    sourcePath: sourceLabel,
    summary: loaded.summary
  };
};

const generate = async (outputDirectory: string) => {
  await mkdir(resolve(outputDirectory, "generated"), { recursive: true });
  const ownerSource = resolve(option("--owner-source") ?? DEFAULT_OWNER_SOURCE);
  const ownerBaseline = flag("--skip-owner") ? null : await captureOwnerBaseline(
    ownerSource, option("--owner-source") ?? OWNER_SOURCE_LABEL, outputDirectory
  );
  const fixtures: FixtureRecord[] = [];
  for (const requestedLandmasses of FIXTURE_COUNTS) {
    const { bytes, record } = await buildFixtureRecord(requestedLandmasses);
    await writeFile(resolve(outputDirectory, record.path), bytes);
    fixtures.push(record);
    console.log(`${record.requestedLandmasses} landmasses: ${record.sha256.slice(0, 12)} ` +
      `(${record.summary.world.landmassCount} components, ${record.counts.buildings} buildings, ` +
      `${record.counts.actors} actors, ${record.counts.settlers} settlers)`);
  }
  const manifest: FixtureManifest = {
    fixtures,
    format: "home-map-island-fixtures",
    generatedBy: GENERATED_BY,
    mapSize: FIXTURE_MAP_SIZE,
    ownerBaseline,
    seed: FIXTURE_SEED,
    version: 1
  };
  await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${resolve(outputDirectory, "manifest.json")}`);
  return manifest;
};

const validate = async (outputDirectory: string) => {
  const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as FixtureManifest;
  if (manifest.format !== "home-map-island-fixtures" || manifest.version !== 1)
    throw new Error("Unsupported fixture manifest");
  if (manifest.mapSize !== FIXTURE_MAP_SIZE || manifest.seed !== FIXTURE_SEED)
    throw new Error("Fixture manifest does not describe the expected fixed map");
  if (manifest.ownerBaseline) {
    const owner = await loadSaveFile(resolve(outputDirectory, manifest.ownerBaseline.path));
    if (sha256(owner.bytes) !== manifest.ownerBaseline.sha256)
      throw new Error("Owner baseline SHA-256 differs from the manifest");
    assertSummary("owner baseline", owner.summary, manifest.ownerBaseline.summary);
    console.log(`owner baseline: ok (${owner.summary.world.landmassCount} landmasses, ` +
      `${owner.summary.settlement.buildings} buildings, ${owner.summary.settlement.actors} actors)`);
  }
  for (const fixture of manifest.fixtures) {
    const stored = await loadSaveFile(resolve(outputDirectory, fixture.path));
    if (sha256(stored.bytes) !== fixture.sha256)
      throw new Error(`${fixture.path}: SHA-256 differs from the manifest`);
    assertSummary(`${fixture.path} file`, stored.summary, fixture.summary);
    const regenerated = await buildFixture(fixture.options, fixture.saveMeta);
    if (sha256(regenerated.bytes) !== fixture.sha256)
      throw new Error(`${fixture.path}: regenerated SHA-256 differs`);
    assertSummary(`${fixture.path} regeneration`, regenerated.summary, fixture.summary);
    if (stored.summary.world.landmassCount !== fixture.requestedLandmasses)
      throw new Error(`${fixture.path}: expected ${fixture.requestedLandmasses} landmasses, ` +
        `got ${stored.summary.world.landmassCount}`);
    console.log(`${fixture.requestedLandmasses} landmasses: ok (${fixture.sha256.slice(0, 12)}, ` +
      `${stored.summary.world.landmasses.map(landmass => landmass.area).join("/")})`);
  }
};

const inspect = async (paths: readonly string[]) => {
  if (!paths.length) throw new Error("inspect needs at least one game-save path");
  const reports = [];
  for (const path of paths) {
    const loaded = await loadSaveFile(resolve(path));
    reports.push({ path, sha256: sha256(loaded.bytes), summary: loaded.summary });
  }
  console.log(JSON.stringify(reports, null, 2));
};

const [command = "generate", ...paths] = process.argv.slice(2);
if (!["generate", "inspect", "validate"].includes(command)) {
  console.log(usage);
  process.exit(1);
}
const outputDirectory = resolve(option("--output") ?? DEFAULT_OUTPUT);
if (command === "generate") await generate(outputDirectory);
else if (command === "validate") await validate(outputDirectory);
else await inspect(paths);
