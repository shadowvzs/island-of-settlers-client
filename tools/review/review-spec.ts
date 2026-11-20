import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

/** Settings > Graphics > Detail presets, passed as `?quality=`. */
export type ReviewPreset = "high" | "low" | "medium" | "minimal";
export type ReviewView = "iso-close" | "iso-far" | "iso-normal" | "possessed-close" | "possessed-normal"
  | "possessed-turn" | "possessed-up" | "possessed-walk" | "possessed-wind" | "spyglass";
export type ReviewWeather = "clear" | "rain" | "snow";

/** A finished building of `nation` at `level` on a flat fixture island (one scene per nation). */
export interface BuildingSubject {
  kind: "building";
  level?: number;
  nation: string;
  rotation?: number;
  typeId: number;
}

/** A road decoration item kind (e.g. `climbing-rose-red`), bought and placed beside an HQ road. */
export interface DecorationSubject {
  item: string;
  kind: "decoration";
}

/** Any ground point of a generated island; `query` overrides the island query (seed, size, dev params). */
export interface PositionSubject {
  kind: "position";
  label?: string;
  query?: string;
  /** Possessed close stand distance (cells, default 4): small props (bushes, saplings) need ~2. */
  stand?: number;
  x: number;
  z: number;
}

export type ReviewSubject = BuildingSubject | DecorationSubject | PositionSubject;

export interface ReviewZoom {
  close: number;
  far: number;
  normal: number;
}

export interface ReviewSpec {
  /** Views aim this many world units above the ground; null = per kind (buildings 1.5, others 0). */
  lift: number | null;
  name: string;
  out: string;
  presets: ReviewPreset[];
  /** Island query of decoration/position scenes (seed, size, cache, login, reveal). */
  query: string;
  subjects: ReviewSubject[];
  /** `?time=`: a preset name (day, dusk, night, ...) or an hour. */
  time: string;
  title: string;
  views: ReviewView[];
  weather: ReviewWeather;
  /** Iso camera quarters (0-3); empty = automatic (the side that keeps the HQ behind the subject). */
  yaws: number[];
  zoom: ReviewZoom;
}

/** One capture: a subject in one preset, view and iso quarter (`yaw` is null outside iso views). */
export interface ReviewShot {
  key: string;
  preset: ReviewPreset;
  subject: number;
  view: ReviewView;
  yaw: number | null;
}

const PRESETS: readonly ReviewPreset[] = ["high", "medium", "low", "minimal"];
const VIEWS: readonly ReviewView[] =
  ["iso-close", "iso-normal", "iso-far", "possessed-close", "possessed-normal", "possessed-up", "possessed-walk",
    "possessed-turn", "possessed-wind", "spyglass"];
const WEATHERS: readonly ReviewWeather[] = ["clear", "rain", "snow"];
const DEFAULT_QUERY = "size=128&seed=123&cache=0&skipLogin=1&reveal=1";
const DEFAULT_VIEWS: ReviewView[] = ["iso-close", "iso-normal", "possessed-close", "possessed-normal", "spyglass"];

const fail = (message: string): never => { throw new Error(`Review spec: ${message}`); };

const checkList = <T extends string>(values: readonly string[], allowed: readonly T[], field: string) => {
  const unknown = values.filter(value => !allowed.includes(value as T));
  if (unknown.length) fail(`unknown ${field} ${unknown.join(", ")} (allowed: ${allowed.join(", ")})`);
  return values as T[];
};

const checkSubject = (subject: ReviewSubject, index: number) => {
  if (subject.kind === "building" && Number.isInteger(subject.typeId) && subject.nation) return subject;
  if (subject.kind === "decoration" && subject.item) return subject;
  if (subject.kind === "position" && Number.isFinite(subject.x) && Number.isFinite(subject.z)) return subject;
  return fail(`subject ${index} needs kind building {typeId, nation}, decoration {item} or position {x, z}`);
};

/**
 * Fills the defaults and validates; `out` resolves against the spec file's folder (default: the system
 * temporary folder, so specs kept in the repository never write captures into it).
 */
export const normaliseSpec = (raw: Partial<ReviewSpec>, specDir = process.cwd()): ReviewSpec => {
  if (!raw.name) fail("name is required");
  if (!raw.subjects?.length) fail("at least one subject is required");
  return {
    lift: raw.lift ?? null,
    name: raw.name!,
    out: raw.out ? resolve(specDir, raw.out) : resolve(tmpdir(), `review-sheet-${raw.name}`),
    presets: checkList(raw.presets ?? ["high", "minimal"], PRESETS, "preset"),
    query: raw.query ?? DEFAULT_QUERY,
    subjects: raw.subjects!.map(checkSubject),
    time: raw.time ?? "day",
    title: raw.title ?? raw.name!,
    views: checkList(raw.views ?? DEFAULT_VIEWS, VIEWS, "view"),
    weather: checkList([raw.weather ?? "clear"], WEATHERS, "weather")[0]!,
    yaws: raw.yaws ?? [],
    zoom: { close: 2.6, far: .7, normal: 1.2, ...raw.zoom }
  };
};

export const loadSpec = (path: string) => {
  const file = resolve(path);
  return normaliseSpec(JSON.parse(readFileSync(file, "utf8")) as Partial<ReviewSpec>, dirname(file));
};

export const isIsoView = (view: ReviewView) => view.startsWith("iso-");

export const subjectLabel = (subject: ReviewSubject) => {
  if (subject.kind === "building")
    return `${subject.nation} #${subject.typeId} L${subject.level ?? 1} r${subject.rotation ?? 0}`;
  if (subject.kind === "decoration") return subject.item;
  return subject.label ?? `x${subject.x} z${subject.z}`;
};

export const subjectSlug = (subject: ReviewSubject) =>
  subjectLabel(subject).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Scene a subject is staged in: one flat fixture per building nation, one island per query. */
export const sceneKey = (subject: ReviewSubject, spec: ReviewSpec) => {
  if (subject.kind === "building") return `building:${subject.nation}`;
  return `island:${subject.kind === "position" && subject.query ? subject.query : spec.query}`;
};

/** Iso quarters a subject is shot from; null means the automatic quarter. */
const isoYaws = (spec: ReviewSpec, subject: ReviewSubject): (number | null)[] => {
  if (spec.yaws.length) return spec.yaws;
  return subject.kind === "building" ? [0] : [null];
};

const shotKey = (spec: ReviewSpec, subject: number, preset: ReviewPreset, view: ReviewView, yaw: number | null) =>
  [subjectSlug(spec.subjects[subject]!), preset, view, yaw === null ? "" : `y${yaw}`].filter(Boolean).join("-");

/** The shots of one subject in one preset, in sheet column order. */
export const subjectShots = (spec: ReviewSpec, subject: number, preset: ReviewPreset): ReviewShot[] =>
  spec.views.flatMap(view => {
    const yaws = isoYaws(spec, spec.subjects[subject]!);
    const angles = isIsoView(view) ? yaws : [null];
    return angles.map(yaw => ({ key: shotKey(spec, subject, preset, view, yaw), preset, subject, view, yaw }));
  });

export const shotLabel = (shot: ReviewShot) => {
  const quarter = shot.yaw === null ? "" : ` · yaw ${shot.yaw}`;
  return `${shot.preset} · ${shot.view}${quarter}`;
};
