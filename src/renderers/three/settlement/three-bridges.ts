import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type Raycaster,
  type Scene
} from "three";

import { addApproachWalls } from "../../../render-common/bridges/bridge-approach-walls";
import {
  applyBridgeLevelFinish, bridgeStoneFinish, bridgeTimberFinish
} from "../../../render-common/bridges/bridge-level-finish";
import {
  type BridgeRecipe,
  bridgeRecipeAdder,
  type BridgeRecipeInput
} from "../../../render-common/bridges/bridge-recipe";
import { stoneArchBridgeRecipe } from "../../../render-common/bridges/stone-arch-bridge-recipe";
import { stoneSlabBridgeRecipe } from "../../../render-common/bridges/stone-slab-bridge-recipe";
import { woodBridgeRecipe } from "../../../render-common/bridges/wood-bridge-recipe";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import {
  BRIDGE_MAX_RAMP_LENGTH,
  bridgeApproaches,
  type BridgeApproachPiece
} from "../../../shared/settlement/bridge-approaches";
import type { BridgeConstructionSnapshot } from "../../../shared/settlement/bridge-construction";
import {
  bridgeDeckHeight,
  type BridgeHeightLookup,
  type BridgeSurfaceProfile,
  type BridgeSurfaceService,
  createBridgeSurfaceHeight,
  createBridgeSurfaceProfiles
} from "../../../shared/settlement/bridge-surface";
import type { RoadDecorationStoneFamily } from "../../../shared/settlement/road-decoration-catalog";
import type { BridgeKind, RoadPoint, RoadSegment } from "../../../shared/settlement/road-types";
import { createBuildingHover } from "../buildings/building-hover";
import { createBuildingShadowCaster } from "../buildings/building-shadows";
import { createBridgeModel } from "./bridge-model";

type MaterialsFor = (nation: WorkerNation) => Record<BuildingSurface, MeshStandardMaterial>;

interface BridgeLayerInput {
  detailed: boolean;
  materialsFor: MaterialsFor;
  nation?: WorkerNation;
  /** Changes when the terrain under a bank changed; bridge art rebuilds its supports then. */
  revision?: () => number;
  shadowScene?: Scene;
  /** Owner 2026-11-07: grey granite, matching the paved stone deck (not warm limestone). */
  stoneFamily?: RoadDecorationStoneFamily;
  surface: BridgeSurfaceService;
  terrainHeight: (x: number, z: number) => number;
  waterHeight: (x: number, z: number) => number;
}

interface BridgeEntry {
  caster?: ReturnType<typeof createBuildingShadowCaster>;
  key: string;
  lastProgress: number;
  /** Absent on an upgrade site: the open bridge keeps its completed model, the site shows its stock. */
  model?: ReturnType<typeof createBridgeModel>;
  root: Group;
  stock?: StockPile;
}

interface StockPile {
  geometries: (BoxGeometry | CylinderGeometry)[];
  root: Group;
}

const worldPoint = (profile: BridgeSurfaceProfile, along: number, across: number) => ({
  x: profile.start.x + profile.unit.x * along - profile.unit.z * across,
  z: profile.start.z + profile.unit.z * along + profile.unit.x * across
});

const recipeInput = (
  profile: BridgeSurfaceProfile,
  detailed: boolean,
  terrainHeight: (x: number, z: number) => number,
  waterHeight: (x: number, z: number) => number,
  roadHeight?: BridgeHeightLookup
): BridgeRecipeInput => ({
  deckTopAt: along => bridgeDeckHeight(profile, along / profile.length),
  detailed,
  length: profile.length,
  terrainAt: (along, across) => {
    const point = worldPoint(profile, along, across);
    return terrainHeight(point.x, point.z);
  },
  tiles: profile.tiles,
  waterAt: (along, across) => {
    const point = worldPoint(profile, along, across);
    return waterHeight(point.x, point.z);
  },
  level: profile.level,
  roadAt: (along, across) => {
    const point = worldPoint(profile, along, across);
    return roadHeight?.(point.x, point.z) ?? terrainHeight(point.x, point.z);
  }
});

const modelKey = (profile: BridgeSurfaceProfile) => [
  profile.id, profile.kind, profile.level, profile.tiles, profile.length.toFixed(4),
  profile.baseHeight.toFixed(4), profile.camber.toFixed(4),
  profile.start.x, profile.start.z, profile.end.x, profile.end.z
].join("/");

/** Shore road pieces of every bridge ramp in `segments`, by bridge id (wing walls and model keys). */
const rampPiecesById = (segments: readonly RoadSegment[]) => {
  const byId = new Map<number, BridgeApproachPiece[]>();
  for (const approach of bridgeApproaches(segments, BRIDGE_MAX_RAMP_LENGTH)) {
    const pieces = byId.get(approach.deck.id) ?? [];
    pieces.push(...approach.pieces);
    byId.set(approach.deck.id, pieces);
  }
  return byId;
};

const piecesKey = (pieces: readonly BridgeApproachPiece[]) =>
  pieces.map(piece => `${piece.from.x},${piece.from.z},${piece.to.x},${piece.to.z}`).join(";");

interface RampContext {
  height: BridgeHeightLookup;
  pieces: readonly BridgeApproachPiece[];
}

/** Stone bridges retain raised shore ramps with wing walls (foundation stage). */
const withApproachWalls = (
  recipe: BridgeRecipe, profile: BridgeSurfaceProfile, ramps: RampContext, detailed: boolean,
  terrainHeight: (x: number, z: number) => number
) => {
  if (profile.kind !== "stone" || !ramps.pieces.length) return recipe;
  const parts = [...recipe.parts];
  addApproachWalls({ detailed, origin: profile.start, pieces: ramps.pieces, rampHeight: ramps.height,
    terrainHeight, unit: profile.unit }, bridgeRecipeAdder(parts)(0));
  return { parts };
};

const kindRecipe = (profile: BridgeSurfaceProfile, input: BridgeRecipeInput) => {
  if (profile.kind === "wood") return woodBridgeRecipe(input);
  if (profile.tiles <= 3) return stoneSlabBridgeRecipe(input);
  return stoneArchBridgeRecipe(input);
};

/** The kind's recipe at the bridge's level: tier colour on top of the level's structural details. */
const bridgeRecipe = (profile: BridgeSurfaceProfile, input: BridgeRecipeInput) =>
  applyBridgeLevelFinish(kindRecipe(profile, input), profile.kind, profile.level);

/** Beside the shore road behind the anchor (dry side first), so an upgrade's stock never sits on traffic. */
const besideRoad = (
  profile: BridgeSurfaceProfile, point: RoadPoint, terrainHeight: (x: number, z: number) => number,
  waterHeight: (x: number, z: number) => number
) => {
  for (const side of [1, -1]) {
    const spot = { x: point.x - profile.unit.z * side * 1.6, z: point.z + profile.unit.x * side * 1.6 };
    if (terrainHeight(spot.x, spot.z) >= waterHeight(spot.x, spot.z)) return spot;
  }
  return point;
};

const placeModel = (root: Group, profile: BridgeSurfaceProfile) => {
  root.position.set(profile.start.x, 0, profile.start.z);
  root.rotation.y = Math.atan2(-profile.unit.z, profile.unit.x);
};

const stockGeometry = (kind: BridgeKind, detailed: boolean) => {
  const geometries: (BoxGeometry | CylinderGeometry)[] = [];
  if (kind === "wood") {
    geometries.push(new CylinderGeometry(0.09, 0.1, 1.0, detailed ? 8 : 6));
    geometries.push(new BoxGeometry(0.9, 0.09, 0.34));
  } else {
    geometries.push(new BoxGeometry(0.46, 0.28, 0.4));
    geometries.push(new BoxGeometry(0.58, 0.18, 0.5));
  }
  return geometries;
};

const createStockPile = (
  kind: BridgeKind,
  detailed: boolean,
  point: RoadPoint,
  ground: number,
  materials: Record<BuildingSurface, MeshStandardMaterial>
): StockPile => {
  const root = new Group();
  root.name = "bridge_stock_pile";
  root.position.set(point.x, ground + 0.02, point.z);
  const geometries = stockGeometry(kind, detailed);
  if (kind === "wood") {
    const [log, plank] = geometries as [CylinderGeometry, BoxGeometry];
    for (let index = 0; index < 4; index += 1) {
      const mesh = new Mesh(log, materials.wood);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(0, 0.1 + index % 2 * 0.17, -0.22 + Math.floor(index / 2) * 0.42);
      root.add(mesh);
    }
    for (let index = 0; index < 3; index += 1) {
      const mesh = new Mesh(plank, materials.planks);
      mesh.position.set(0, 0.3 + index * 0.1, 0);
      mesh.rotation.y = index * 0.08;
      root.add(mesh);
    }
  } else {
    const [small, large] = geometries as [BoxGeometry, BoxGeometry];
    for (let index = 0; index < 5; index += 1) {
      const mesh = new Mesh(index % 2 === 0 ? small : large, materials.stone);
      mesh.position.set((index % 2 ? 0.18 : -0.16), 0.1 + Math.floor(index / 3) * 0.24,
        (index % 3 - 1) * 0.28);
      mesh.rotation.y = index * 0.31;
      root.add(mesh);
    }
  }
  return { geometries, root };
};

/** Finished bridge art and its construction-stage model; one merged draw per surface. */
export const createThreeBridges = (input: BridgeLayerInput) => {
  const { detailed, materialsFor, revision = () => 0, shadowScene, stoneFamily = "granite", surface } = input;
  const root = new Group();
  root.name = "settlement_bridges";
  const materials = materialsFor(input.nation ?? "roman");
  const shadowMaterial = new MeshBasicMaterial();
  const completed = new Map<number, BridgeEntry>();
  const sites = new Map<number, BridgeEntry>();
  let completedRamps: { byId: Map<number, BridgeApproachPiece[]>; segments: readonly RoadSegment[] } =
    { byId: new Map(), segments: [] };
  const siteRampCache = new Map<number, { key: string; ramps: RampContext }>();
  /** A site's future ramps (not on the live surface yet), recomputed only when roads or the site change. */
  const siteRamps = (snapshot: BridgeConstructionSnapshot, profile: BridgeSurfaceProfile): RampContext => {
    const roads = surface.segments();
    const key = `${modelKey(profile)}/${roads.length}`;
    const cached = siteRampCache.get(snapshot.id);
    if (cached && cached.key === key && completedRamps.segments === roads) return cached.ramps;
    const withSite = [...roads, ...snapshot.segments];
    let lookup: BridgeHeightLookup | undefined;
    const ramps: RampContext = {
      height: (x, z) => (lookup ??= createBridgeSurfaceHeight(withSite, input.terrainHeight, input.waterHeight))(x, z),
      pieces: rampPiecesById(withSite).get(profile.id) ?? []
    };
    siteRampCache.set(snapshot.id, { key, ramps });
    return ramps;
  };
  const entryKey = (profile: BridgeSurfaceProfile, ramps: RampContext) =>
    `${modelKey(profile)}/${revision()}/${piecesKey(ramps.pieces)}`;

  const removeEntry = (entry: BridgeEntry) => {
    entry.model?.dispose();
    entry.caster?.dispose();
    entry.stock?.root.removeFromParent();
    for (const geometry of entry.stock?.geometries ?? []) geometry.dispose();
    entry.root.removeFromParent();
  };

  const createEntry = (
    profile: BridgeSurfaceProfile, ramps: RampContext, progress: number, stockPoint?: RoadPoint
  ) => {
    const recipe = bridgeRecipe(profile, recipeInput(profile, detailed, input.terrainHeight, input.waterHeight,
      ramps.height));
    const finish = profile.kind === "stone" && profile.level ? bridgeStoneFinish(profile.kind, profile.level)
      : stoneFamily;
    const model = createBridgeModel(withApproachWalls(recipe, profile, ramps, detailed, input.terrainHeight),
      materials, detailed, finish, profile.kind === "wood" ? bridgeTimberFinish("wood", profile.level) : undefined);
    placeModel(model.root, profile);
    const entryRoot = new Group();
    entryRoot.add(model.root);
    root.add(entryRoot);
    const stock = stockPoint
      ? createStockPile(profile.kind, detailed, stockPoint, input.terrainHeight(stockPoint.x, stockPoint.z), materials)
      : undefined;
    if (stock) entryRoot.add(stock.root);
    let caster: BridgeEntry["caster"];
    if (detailed && shadowScene) {
      caster = createBuildingShadowCaster(model.root, shadowMaterial, true);
      shadowScene.add(caster.root);
    }
    model.setProgress(progress);
    caster?.update();
    return {
      caster,
      key: entryKey(profile, ramps),
      lastProgress: progress,
      model,
      root: entryRoot,
      stock
    };
  };

  const syncCompleted = (profiles: readonly BridgeSurfaceProfile[]) => {
    const active = new Set(profiles.map(profile => profile.id));
    for (const [id, entry] of completed) {
      if (active.has(id)) continue;
      removeEntry(entry);
      completed.delete(id);
    }
    const segments = surface.segments();
    if (segments !== completedRamps.segments)
      completedRamps = { byId: rampPiecesById(segments), segments };
    for (const profile of profiles) {
      const ramps = { height: surface.height, pieces: completedRamps.byId.get(profile.id) ?? [] };
      const key = entryKey(profile, ramps);
      let entry = completed.get(profile.id);
      if (entry && entry.key !== key) {
        removeEntry(entry);
        completed.delete(profile.id);
        entry = undefined;
      }
      if (!entry) {
        entry = createEntry(profile, ramps, 1);
        completed.set(profile.id, entry);
      }
      if (entry.lastProgress !== 1) {
        entry.model?.setProgress(1);
        entry.lastProgress = 1;
        entry.caster?.update();
      }
    }
  };

  /** An upgrade site of an open bridge: only its delivered stock, beside the shore road. */
  const createUpgradeEntry = (snapshot: BridgeConstructionSnapshot, profile: BridgeSurfaceProfile): BridgeEntry => {
    const spot = besideRoad(profile, snapshot.stockPoint, input.terrainHeight, input.waterHeight);
    const stock = createStockPile(profile.kind, detailed, spot, input.terrainHeight(spot.x, spot.z), materials);
    const entryRoot = new Group();
    entryRoot.add(stock.root);
    root.add(entryRoot);
    return { key: `upgrade/${modelKey(profile)}/${spot.x}/${spot.z}`, lastProgress: snapshot.progress,
      root: entryRoot, stock };
  };

  const siteEntry = (snapshot: BridgeConstructionSnapshot, profile: BridgeSurfaceProfile): BridgeEntry => {
    if (snapshot.upgrade) {
      const key = `upgrade/${modelKey(profile)}`;
      const entry = sites.get(snapshot.id);
      if (entry?.key.startsWith(key)) return entry;
      if (entry) removeEntry(entry);
      return createUpgradeEntry(snapshot, profile);
    }
    const ramps = siteRamps(snapshot, profile);
    const key = entryKey(profile, ramps);
    const entry = sites.get(snapshot.id);
    if (entry?.key === key) return entry;
    if (entry) removeEntry(entry);
    // A bridge coming down shows no stock pile: nothing is delivered to it.
    return createEntry(profile, ramps, snapshot.progress, snapshot.dismantling ? undefined : snapshot.stockPoint);
  };

  const syncSites = (snapshots: readonly BridgeConstructionSnapshot[]) => {
    const active = new Set(snapshots.map(snapshot => snapshot.id));
    for (const [id, entry] of sites) {
      if (active.has(id)) continue;
      removeEntry(entry);
      sites.delete(id);
      siteRampCache.delete(id);
    }
    for (const snapshot of snapshots) {
      const profiles = createBridgeSurfaceProfiles(snapshot.segments, input.terrainHeight, input.waterHeight);
      const profile = profiles[0];
      if (!profile) continue;
      const entry = siteEntry(snapshot, profile);
      sites.set(snapshot.id, entry);
      if (entry.lastProgress !== snapshot.progress) {
        entry.model?.setProgress(snapshot.progress);
        entry.lastProgress = snapshot.progress;
        entry.caster?.update();
      }
      if (entry.stock) entry.stock.root.visible = snapshot.progress < 1;
    }
  };

  const hover = createBuildingHover(root as unknown as Scene, { name: "bridge_hover_outline", respectDrawRange: true });
  let hovered: number | null = null, selected: number | null = null;
  /** The completed bridge's model, or the construction site (its staged model and stock). */
  const outlineRoot = (id: number | null) => {
    if (id === null) return undefined;
    return completed.get(id)?.root ?? sites.get(id)?.root;
  };
  const refreshOutline = () => hover.set(outlineRoot(hovered ?? selected));

  const owner = (object: Object3D) => {
    for (const map of [completed, sites])
      for (const [id, entry] of map)
        for (let node: Object3D | null = object; node; node = node.parent) if (node === entry.root) return id;
    return null;
  };
  /** The bridge (completed or site) nearest along the ray, with its hit distance. */
  const pickHit = (raycaster: Raycaster) => {
    const roots = [...completed.values(), ...sites.values()].map(entry => entry.root);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      if (hit.object.name === "bridge_hover_outline") continue;
      const id = owner(hit.object);
      if (id !== null) return { distance: hit.distance, id };
    }
    return undefined;
  };

  const update = (sitesSnapshot: readonly BridgeConstructionSnapshot[]) => {
    syncCompleted(surface.profiles());
    syncSites(sitesSnapshot);
    if (hovered !== null && !outlineRoot(hovered)) hovered = null;
    if (selected !== null && !outlineRoot(selected)) selected = null;
    refreshOutline();
  };

  const dispose = () => {
    hover.dispose();
    for (const entry of completed.values()) removeEntry(entry);
    for (const entry of sites.values()) removeEntry(entry);
    completed.clear();
    sites.clear();
    shadowMaterial.dispose();
    root.removeFromParent();
  };

  return {
    dispose,
    pickHit,
    root,
    /** Hover outline (like buildings); true when a bridge is under the pointer. */
    setHover: (id: number | null) => {
      hovered = id !== null && outlineRoot(id) ? id : null;
      refreshOutline();
      return hovered !== null;
    },
    /** The bridge whose panel is open keeps its outline while the pointer is elsewhere. */
    setSelected: (id: number | null) => {
      selected = id;
      refreshOutline();
    },
    update
  };
};
