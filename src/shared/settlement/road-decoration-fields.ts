import { HIVE_BENCH_TOP, HIVE_EKE_HEIGHT } from "../../render-common/props/drink-crops/beehive-mesh";
import { createDrinkCropMesh } from "../../render-common/props/drink-crops/drink-crop-meshes";
import { VINE_VARIANTS } from "../../render-common/props/drink-crops/grapevine-mesh";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import { createWheatMeshData } from "../../render-common/wheat-field";
import { sampleSmooth } from "../world/grid-geometry";
import { CHARCOAL_LOG_HALF_LENGTH, CHARCOAL_LOG_RADIUS, CHARCOAL_MOUND_RADIUS, CHARCOAL_MOUND_TOP_Y } from "./charcoal-field";
import type { FieldKind } from "./settlement-field-cycles";
import type { SettlementContext } from "./settlement-types";

const MAX_WIND = Math.hypot(.8, .35) * 2.7;
const envelopes = new Map<FieldKind, { radius: number; height: number }>();
const cropKeys = (kind: FieldKind) => {
  if (kind === "vine") return ["vine-trellis", ...Array.from({ length: VINE_VARIANTS }, (_, index) => `vine-plant-leafy-${index}`),
    ...[0, 1, 2].map(index => `vine-bunch-full-${index}`)];
  if (kind === "rice") return ["rice-seedling", "rice-tillering", "rice-heading", "rice-ripe", "rice-stubble"];
  if (kind === "hive") return ["hive-stand", "hive-eke", "hive-skep", "hive-drip"];
  if (kind === "palm") return ["palm-tree-5", "palm-fruit-full", ...[0, 1, 2].map(index => `palm-fallen-${index}`)];
  return ["young", "leafy", "fruiting", "ripe", "picked"].map(stage => `${kind}-${stage}`);
};

/** Union of actual authored High+Minimal mature stages, including maximum wind. Growth needs no repeated checks. */
export const roadDecorationFieldEnvelope = (kind: FieldKind) => {
  const cached = envelopes.get(kind); if (cached) return cached;
  let radius = .5, height = .1;
  if (kind === "charcoal") {
    radius = Math.max(CHARCOAL_MOUND_RADIUS, CHARCOAL_LOG_HALF_LENGTH + CHARCOAL_LOG_RADIUS);
    height = CHARCOAL_MOUND_TOP_Y;
  } else if (kind === "grain" || kind === "flax") {
    for (const detailed of [true, false]) {
      const mesh = createWheatMeshData(0, detailed, kind === "grain" ? "wheat" : "flax");
      for (let index = 0; index < mesh.positions.length; index += 3) {
        radius = Math.max(radius, Math.hypot(mesh.positions[index]!, mesh.positions[index + 2]!) + .2);
        height = Math.max(height, mesh.positions[index + 1]! + .1);
      }
    }
  } else for (const detailed of [true, false]) for (const key of cropKeys(kind)) {
    const mesh = createDrinkCropMesh(key, detailed);
    let sway = 0, flutter = 0;
    for (let index = 0; index < mesh.wind.length; index += 2) {
      sway = Math.max(sway, mesh.wind[index]!); flutter = Math.max(flutter, mesh.wind[index + 1]!);
    }
    const wind = MAX_WIND * (sway * sway * .14 + flutter * .015 * Math.SQRT2);
    radius = Math.max(radius, mesh.radius * 1.06 + wind + (kind === "hive" ? .32 : 0));
    height = Math.max(height, mesh.height * 1.06 + MAX_WIND * (sway * sway * .03 + flutter * .009) +
      (kind === "hive" ? HIVE_BENCH_TOP + HIVE_EKE_HEIGHT * 3 : 0));
  }
  const result = { radius, height }; envelopes.set(kind, result); return result;
};
export const roadDecorationFieldBounds = (context: SettlementContext, kind: FieldKind, x: number, z: number): RoadDecorationBounds => {
  const { height, radius } = roadDecorationFieldEnvelope(kind), y = sampleSmooth(context.options.world, context.options.world.heights, x, z);
  return { min: [x - radius, y - .05, z - radius], max: [x + radius, y + height, z + radius] };
};

/** Active fields reserve their full mature volume. Stubble retains its site's future growth reservation. */
export const createRoadDecorationFieldClearance = (context: SettlementContext) => {
  let revision = "";
  const buckets = new Map<string, Set<RoadDecorationBounds>>();
  const keys = (box: RoadDecorationBounds) => {
    const result: string[] = [];
    for (let z = Math.floor(box.min[2] / 4); z <= Math.floor(box.max[2] / 4); z++)
      for (let x = Math.floor(box.min[0] / 4); x <= Math.floor(box.max[0] / 4); x++) result.push(`${x}:${z}`);
    return result;
  };
  return (target: RoadDecorationBounds) => {
    const next = `${context.fieldCycles?.revision() ?? 0}:${context.options.world.terrainRevision ?? 0}`;
    if (next !== revision) {
      revision = next; buckets.clear();
      for (const field of context.fieldCycles?.snapshot() ?? []) {
        const box = roadDecorationFieldBounds(context, field.kind, field.x, field.z);
        for (const key of keys(box)) { const list = buckets.get(key) ?? new Set(); list.add(box); buckets.set(key, list); }
      }
    }
    for (const key of keys(target)) for (const box of buckets.get(key) ?? []) if ([0, 1, 2].every(axis =>
      target.min[axis]! < box.max[axis]! - .000001 && target.max[axis]! > box.min[axis]! + .000001)) return true;
    return false;
  };
};
