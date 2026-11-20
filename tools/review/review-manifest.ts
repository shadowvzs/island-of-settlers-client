import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { SheetLayout, SheetRow } from "./review-contact-sheet";
import type { ShotResult } from "./review-shots";
import { type ReviewPreset, type ReviewShot, type ReviewSpec, shotLabel, subjectLabel,
  subjectShots } from "./review-spec";

/** One manifest entry; `file` is relative to the output folder, so a folder can be moved or diffed. */
export interface ManifestShot {
  file: string;
  key: string;
  label: string;
  preset: ReviewPreset;
  remaining?: number;
  subject: string;
  view: string;
  yaw: number | null;
}

export interface ReviewManifest {
  errors: string[];
  generatedAt: string;
  revision: string;
  sheets: string[];
  shots: ManifestShot[];
  spec: ReviewSpec;
}

export const MANIFEST = "manifest.json";
export const SHOTS_DIR = "shots";

export const manifestShot = (spec: ReviewSpec, out: string, shot: ReviewShot, result: ShotResult): ManifestShot => ({
  file: relative(out, result.file), key: shot.key, label: shotLabel(shot), preset: shot.preset,
  remaining: result.remaining, subject: subjectLabel(spec.subjects[shot.subject]!), view: shot.view, yaw: shot.yaw
});

export const readManifest = (dir: string): ReviewManifest =>
  JSON.parse(readFileSync(resolve(dir, MANIFEST), "utf8")) as ReviewManifest;

/** Each (subject, preset) pair in sheet row order. */
const rowPairs = (spec: ReviewSpec) =>
  spec.subjects.flatMap((_, subject) => spec.presets.map(preset => ({ preset, subject })));

/** The shot files of one folder by key (its manifest when present, else `shots/<key>.png`). */
const shotFiles = (dir: string) => {
  const path = resolve(dir, MANIFEST);
  const shots = existsSync(path) ? readManifest(dir).shots : [];
  const files = new Map(shots.map(shot => [shot.key, resolve(dir, shot.file)]));
  return (key: string) => files.get(key) ?? resolve(dir, SHOTS_DIR, `${key}.png`);
};

const sheetRow = (spec: ReviewSpec, subject: number, preset: ReviewPreset, file: (key: string) => string,
  suffix = ""): SheetRow => ({
  cells: subjectShots(spec, subject, preset).map(shot => ({ label: shotLabel(shot), path: file(shot.key) })),
  heading: `${subjectLabel(spec.subjects[subject]!)} · ${preset}${suffix}`
});

const columnCount = (spec: ReviewSpec) =>
  Math.max(...rowPairs(spec).map(({ preset, subject }) => subjectShots(spec, subject, preset).length));

/** One row per subject and preset, one column per view (and iso quarter). */
export const reviewLayout = (spec: ReviewSpec, out: string): SheetLayout => ({
  columns: columnCount(spec),
  rows: rowPairs(spec).map(({ preset, subject }) => sheetRow(spec, subject, preset, shotFiles(out))),
  title: spec.title
});

/** Before/after pairs: each subject and preset as a "before" row directly above its "after" row. */
export const compareLayout = (spec: ReviewSpec, out: string, before: string): SheetLayout => {
  const beforeFile = shotFiles(before), afterFile = shotFiles(out);
  return {
    columns: columnCount(spec),
    rows: rowPairs(spec).flatMap(({ preset, subject }) => [
      sheetRow(spec, subject, preset, beforeFile, " · before"),
      sheetRow(spec, subject, preset, afterFile, " · after")
    ]),
    title: `${spec.title} — before / after`
  };
};
