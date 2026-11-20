import {
  BufferGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, type MeshStandardMaterial
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { QualityLevel } from "../../../render-common/quality";
import {
  layoutShipDeck, SHIP_DECK_PERSON_WORLD, SHIP_DECK_RIGGING, type ShipDeckSlot
} from "../../../render-common/ships/ship-deck-layout";
import { troopShipDeckPlaces } from "../../../render-common/ships/ship-deck-people";
import { SAILING_SHIP_SCALE } from "../../../render-common/ships/ship-dimensions";
import type { ShipFrame, ShipSiteFrame } from "../../../render-common/ships/ship-frame";
import { shipBobbing, shipPitch } from "../../../render-common/ships/ship-motion";
import { deckCargoPresentation } from "../../../shared/settlement/ship-cargo-presentation";
import { SHIPYARD_MAST_CLOTH, SHIPYARD_RECIPES } from "../../../shared/settlement/shipyard-recipes";
import { createCoinChestInstances } from "./coin-chest-instances";
import { createShipRibGeometries } from "./roman-ship-hull";
import { type ShipClothMotion, STATIC_SHIP_CLOTH } from "./ship-cloth-wind";
import { sliceShipGeometry } from "./ship-construction-geometry";
import {
  PIRATE_NEAR_ZOOM, type PirateCraftModel, type PirateShipModels, pirateShipVariant
} from "./pirate-ship-models";
import { createShipFigureheads } from "./ship-figureheads";
import { createShipKit, type ShipKit } from "./ship-kit";
import { createShipMastFlag, type ShipVisualEnvironment } from "./ship-mast-flag";
import { createShipMaterials, SAIL_MATERIALS } from "./ship-materials";
import { loadShipPremiumTextures } from "./ship-premium-textures";
import { SHIP_STYLES, type ShipInstancedFitting, type ShipStyle,shipStyleFor } from "./ship-styles";
import { createThreeHarbourLighters } from "./three-harbour-lighters";
import { createThreeShipWorkPiers } from "./three-ship-work-piers";
import type { SmallBoatPeople } from "./three-small-boat-people";

/** Sheets and mast stays lie aft of the billowed cloth, leaving its face unobstructed. */
export const SHIP_RIGGING_ROPES = SHIP_DECK_RIGGING;

type Batch = { geometry: BufferGeometry; material: MeshStandardMaterial };

/**
 * Static parts are built once per key (hull style, rig style, crate) and merged into one batch per
 * material; later crafts only add meshes of the cached batches. One-off geometries are freed after
 * the merge.
 */
const createStaticBatches = (own: <T extends BufferGeometry>(geometry: T) => T) => {
  const cache = new Map<string, Batch[]>(), temporary: BufferGeometry[] = [];
  const sliceCache = new Map<string, Batch[][]>();
  const temp = <T extends BufferGeometry>(geometry: T) => { temporary.push(geometry); return geometry; };
  const merge = (parent: Group): Batch[] => {
    const buckets = new Map<MeshStandardMaterial, Mesh[]>();
    for (const child of parent.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      const material = mesh.material as MeshStandardMaterial;
      const bucket = buckets.get(material) ?? []; bucket.push(mesh); buckets.set(material, bucket);
    }
    return Array.from(buckets, ([material, meshes]) => {
      // Indexed pieces stay indexed; a bucket mixing both kinds is merged without an index.
      const indexed = meshes.every(mesh => mesh.geometry.index);
      const list = meshes.map(mesh => {
        mesh.updateMatrix();
        const piece = indexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
        return piece.applyMatrix4(mesh.matrix);
      });
      const geometry = own(mergeGeometries(list, false)!); list.forEach(piece => piece.dispose());
      return { geometry, material };
    });
  };
  /** Adds the batches of `key` to `parent`, building them with `build` the first time. */
  const addStatic = (parent: Group, key: string, build: (scratch: Group) => void) => {
    let batches = cache.get(key);
    if (!batches) {
      const scratch = new Group(); build(scratch);
      batches = merge(scratch); cache.set(key, batches);
      temporary.splice(0).forEach(geometry => geometry.dispose());
    }
    for (const batch of batches) {
      const mesh = new Mesh(batch.geometry, batch.material); mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
    }
  };
  /** Adds one group per material slice; callers show only the slices whose material was consumed. */
  const addStaticSlices = (parent: Group, key: string, build: (scratch: Group, fittings: Group) => void, count: number,
    axis: "x" | "y" | "z") => {
    let slices = sliceCache.get(key);
    if (!slices) {
      const scratch = new Group(), fittings = new Group(); build(scratch, fittings);
      const batches = merge(scratch);
      slices = Array.from({ length: count }, () => []);
      for (const batch of batches) batch.geometry.computeBoundingBox();
      const range = { minimum: Math.min(...batches.map(batch => batch.geometry.boundingBox!.min[axis])),
        maximum: Math.max(...batches.map(batch => batch.geometry.boundingBox!.max[axis])) };
      for (const batch of batches) {
        const geometries = sliceShipGeometry(batch.geometry, count, axis, own, false, range);
        geometries.forEach((geometry, index) => slices![index]!.push({ geometry, material: batch.material }));
      }
      // Oars and rudders are fitted whole after the planking, rather than sliced into floating scraps.
      slices[count - 1]!.push(...merge(fittings));
      sliceCache.set(key, slices);
      temporary.splice(0).forEach(geometry => geometry.dispose());
    }
    return slices.map((batches, index) => {
      const piece = new Group(); piece.name = `${key}-${index}`;
      for (const batch of batches) {
        if (!batch.geometry.getAttribute("position")?.count) continue;
        const mesh = new Mesh(batch.geometry, batch.material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        piece.add(mesh);
      }
      parent.add(piece);
      return piece;
    });
  };
  return { addStatic, addStaticSlices, temp };
};

interface CraftBase {
  root: Group; cargo: Group;
  /** The hull style, or `pirate-<variant>` for an owner pirate model; a changed look rebuilds the craft. */
  look: string;
  /** The deck layout the crates stand in: people and horses aboard. */
  crateLayout: string;
  coinCargo: ReturnType<ReturnType<typeof createCoinChestInstances>["create"]>;
}

/** A raider drawn with the owner's pirate model (pirate-ship-models.ts) instead of a procedural hull. */
interface PirateCraft extends CraftBase { pirate: PirateCraftModel }

interface ProceduralCraft extends CraftBase {
  ribs: Group; hull: Group; rig: Group; flag: Mesh; sail: Mesh; style: ShipStyle;
  /** Finished expansion hulls use whole material batches; construction alone uses the plank slices. */
  completedHull?: Group;
  /** Cloth panel meshes revealed one per fitted cloth roll. */
  clothPieces: Mesh[];
  clothRoll: Mesh;
  fittings?: Group;
  figurehead: ReturnType<ReturnType<typeof createShipFigureheads>["createFor"]>;
}

type Craft = PirateCraft | ProceduralCraft;

/** Ships and the hull construction sites (docks, jetties and piers draw elsewhere), keyed per craft. */
const craftFrames = (ships: readonly ShipFrame[], sites: readonly ShipSiteFrame[]) => [
  ...ships.map((ship) => ({ ...ship, key: `ship-${ship.id}`, progress: 1 })),
  ...sites.filter(site => site.kind !== "dock" && site.kind !== "jetty" && site.kind !== "pier")
    .map((site) => ({ ...site, key: `site-${site.id}`, cargoCount: 0 }))
];
type CraftFrame = ReturnType<typeof craftFrames>[number];

/** Render-only movement; a removed hull has no saved animation state. */
const positionCraft = (model: Craft, frame: Pick<ShipFrame, "id" | "x" | "y" | "z" | "yaw">,
  time: number, finished: boolean, demo: boolean, sink: number) => {
  const bobbing = finished && !demo && !sink ? shipBobbing(frame.id, time) : 0;
  let pitch = 0;
  if (sink) pitch = sink * .28;
  else if (finished && !demo) pitch = shipPitch(frame.id, time);
  model.root.position.set(frame.x, frame.y - sink * sink * 12 + bobbing, frame.z);
  model.root.rotation.set(pitch, frame.yaw, sink * .16);
};

/** Construction slices stay exact; finished expansion hulls draw each material once. */
const showCraftHull = (model: ProceduralCraft, finished: boolean, planks: number) => {
  model.hull.visible = !finished || !model.completedHull;
  if (model.completedHull) model.completedHull.visible = finished;
  model.hull.children.forEach((piece, index) => { piece.visible = finished || index < planks; });
};

/**
 * Crate places on the deck left free by `passengers` people and `horses` riders' horses (horses stand
 * first, then people), per head and horse count.
 */
const crateSlotCache = new Map<string, readonly ShipDeckSlot[]>();
const crateSlotsFor = (passengers: number, horses = 0) => {
  const key = `${passengers}:${horses}`;
  let slots = crateSlotCache.get(key);
  if (!slots) {
    slots = layoutShipDeck(SHIP_DECK_PERSON_WORLD, passengers, Infinity, undefined, horses, true).slots
      .filter(slot => slot.kind === "crate");
    crateSlotCache.set(key, slots);
  }
  return slots;
};
/** The most crates a deck takes (nobody aboard). */
const MAX_CRATES = crateSlotsFor(0).length;
const placeCrates = (cargo: Group, slots: readonly ShipDeckSlot[]) => {
  const matrix = new Matrix4();
  for (const child of cargo.children) {
    if (!(child instanceof InstancedMesh)) continue;
    const instances = child as InstancedMesh;
    slots.forEach((slot, index) => instances.setMatrixAt(index, matrix.makeTranslation(slot.x, slot.y, slot.z)));
    instances.count = slots.length;
    instances.instanceMatrix.needsUpdate = true;
    if (slots.length) instances.computeBoundingSphere();
  }
};

const buildCrate = (kit: ShipKit, crate: Group) => {
  kit.add(crate, "wood", [.15, .1125, .15], [0, .05625, 0]);
  for (const x of [-.065, .065]) kit.add(crate, "dark", [.012, .11, .15], [x, .05625, 0]);
  if (kit.detailed) for (const y of [.026, .082]) kit.add(crate, "deck", [.15, .006, .006], [0, y, .074]);
};

/**
 * Coastal merchant craft in each nation's style (Roman merchant, Viking longship, Japanese bune,
 * Nubian lateen trader) on one shared deck and footprint; construction frames reveal keel, ribs,
 * hull and rigging. `onCraftCreated` receives every new craft root (programs compile ahead of its
 * first draw, which may come much later when it enters the view). `cloth` moves the sails in the wind
 * (SHIP-WIND); the default keeps them at rest.
 */
export const createThreeSettlementShips = (
  quality: QualityLevel = "high",
  people?: SmallBoatPeople,
  onCraftCreated?: (root: Group) => void,
  cloth: ShipClothMotion = STATIC_SHIP_CLOTH,
  pirateModels?: PirateShipModels
) => {
  const group = new Group(); group.name = "settlement_ships";
  const detailed = quality !== "minimal";
  const coinChests = createCoinChestInstances(detailed);
  const { dispose: disposeMaterials, materials } = createShipMaterials();
  for (const name of SAIL_MATERIALS) cloth.prepareMaterial(materials[name]);
  const sailCloth = { enemy: materials.enemyCloth, neutral: materials.neutralCloth };
  const premiumTextures = loadShipPremiumTextures(materials, detailed);
  const mastFlag = createShipMastFlag(detailed);
  const piers = createThreeShipWorkPiers(materials.wood, detailed);
  const lighters = createThreeHarbourLighters(detailed, people);
  const geometries: BufferGeometry[] = [];
  const own = <T extends BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry; };
  const batches = createStaticBatches(own);
  const kit = createShipKit(detailed, materials, own, batches.temp);
  const figureheads = createShipFigureheads(detailed, own, materials);
  const ribGeometries = createShipRibGeometries(detailed, own);
  const sails = new Map<ShipStyle, BufferGeometry>();
  const sailFor = (style: ShipStyle) => {
    let sail = sails.get(style);
    if (!sail) {
      sail = own(SHIP_STYLES[style].createSail(detailed));
      cloth.prepareGeometry(sail); sails.set(style, sail);
    }
    return sail;
  };
  const sailPieces = new Map<ShipStyle, BufferGeometry[]>();
  const sailPiecesFor = (style: ShipStyle) => {
    let pieces = sailPieces.get(style);
    if (!pieces) {
      pieces = sliceShipGeometry(sailFor(style), SHIPYARD_RECIPES.ships.cloth, "y", own, true);
      pieces.forEach(cloth.prepareGeometry);
      sailPieces.set(style, pieces);
    }
    return pieces;
  };
  const fittingParts = new Map<ShipInstancedFitting, ReturnType<ShipInstancedFitting["create"]>>();
  /** One instanced mesh of `fitting` for a craft; geometry and material are shared by every craft. */
  const createFitting = (fitting: ShipInstancedFitting) => {
    let parts = fittingParts.get(fitting);
    if (!parts) { parts = fitting.create(detailed); own(parts.geometry); fittingParts.set(fitting, parts); }
    const placements = fitting.placements();
    const instances = new InstancedMesh(parts.geometry, parts.material, placements.length);
    placements.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.name = fitting.name; instances.castShadow = true; instances.receiveShadow = true;
    return instances;
  };
  /** A rolled canvas is the same spare part on every craft; only its cloth material changes. */
  const clothRollGeometry = own(new CylinderGeometry(.06, .06, .52, detailed ? 10 : 6));
  cloth.prepareGeometry(clothRollGeometry);
  const craft = new Map<string, Craft>();
  const createCargo = () => {
    const cargo = new Group(), crate = new Group(); cargo.name = "ship_cargo";
    batches.addStatic(crate, "cargo-crate", scratch => buildCrate(kit, scratch));
    for (const piece of crate.children) {
      const source = piece as Mesh;
      const instances = new InstancedMesh(source.geometry, source.material, MAX_CRATES);
      instances.name = "ship_deck_crates"; instances.count = 0; cargo.add(instances);
    }
    placeCrates(cargo, crateSlotsFor(0));
    return cargo;
  };
  /** Builds a new craft around its deck cargo (`build` places it in the root) and registers it. */
  const addCraft = <T extends Craft>(root: Group, build: (cargo: Group, coinCargo: CraftBase["coinCargo"]) => T) => {
    const cargo = createCargo();
    const coinCargo = coinChests.create(MAX_CRATES, 1 / SAILING_SHIP_SCALE); cargo.add(coinCargo.root);
    const result = build(cargo, coinCargo);
    group.add(root);
    onCraftCreated?.(root);
    craft.set(root.name, result); return result;
  };
  const createPirate = (key: string, look: string, model: PirateCraftModel) => {
    const root = new Group(); root.name = key;
    return addCraft(root, (cargo, coinCargo) => {
      root.add(model.root, cargo);
      return { cargo, coinCargo, crateLayout: "0:0", look, pirate: model, root };
    });
  };
  const create = (key: string, style: ShipStyle): ProceduralCraft => {
    const recipe = SHIP_STYLES[style];
    const root = new Group(), ribs = new Group(), hull = new Group(), rig = new Group();
    root.name = key; hull.name = "ship_hull";
    // Keel and ribs are the construction frame: the planking closes them in.
    batches.addStatic(ribs, "ribs", scratch => {
      kit.add(scratch, "dark", [0.05, 0.06, 1.7], [0, -0.1, 0]);
      for (const geometry of ribGeometries) kit.mesh(scratch, "dark", geometry);
    });
    batches.addStaticSlices(hull, `hull-${style}`, (scratch, fittings) => recipe.buildHull(kit, scratch, fittings),
      SHIPYARD_RECIPES.ships.planks, "y");
    const expansion = ["chinese", "persian", "maya", "indigenous"].includes(style);
    const completedHull = expansion ? new Group() : undefined;
    if (completedHull) {
      completedHull.name = "ship_finished_hull";
      batches.addStatic(completedHull, `completed-hull-${style}`, scratch => recipe.buildHull(kit, scratch, scratch));
    }
    batches.addStatic(rig, `rig-${style}`, scratch => recipe.buildRig(kit, scratch));
    const fittings = recipe.fittings ? new Group() : undefined;
    if (fittings) fittings.add(createFitting(recipe.fittings!));
    const sail = new Mesh(sailFor(style), materials[recipe.cloth]); sail.name = "ship_sail";
    const clothPieces = sailPiecesFor(style).map((geometry, index) => {
      const piece = new Mesh(geometry, materials[recipe.cloth]);
      piece.name = `ship_sail_cloth_${index}`; piece.castShadow = true; piece.receiveShadow = true;
      return piece;
    });
    const clothGroup = new Group(); clothGroup.name = "ship_cloth_pieces"; clothGroup.add(...clothPieces);
    const clothRoll = new Mesh(clothRollGeometry, materials[recipe.cloth]);
    clothRoll.name = "ship_rolled_canvas"; clothRoll.rotation.z = Math.PI / 2;
    clothRoll.position.set(0, .28, .2); clothRoll.castShadow = true; clothGroup.add(clothRoll);
    const flag = mastFlag.createMesh();
    if (recipe.flagOffset) flag.position.set(...recipe.flagOffset);
    rig.add(sail, flag);
    const figurehead = figureheads.createFor();
    figurehead.root.position.set(...recipe.figureheadOffset);
    return addCraft(root, (cargo, coinCargo) => {
      root.add(ribs, hull, rig, cargo, figurehead.root, clothGroup);
      if (fittings) root.add(fittings);
      if (completedHull) root.add(completedHull);
      return { cargo, clothPieces, clothRoll, coinCargo, completedHull, crateLayout: "0:0", figurehead, fittings, flag,
        hull, look: style, ribs, rig, root, sail, style };
    });
  };
  /**
   * The boxes on deck, laid out round the people and the riders' horses aboard; test loads show one
   * crate per dummy ware.
   */
  const updateCrates = (model: Craft, frame: Partial<ShipFrame>, finished: boolean) => {
    const passengers = frame.deckPassengers ?? 0;
    const horses = troopShipDeckPlaces(passengers, frame.deckTroops ?? []).horses.length;
    const slots = crateSlotsFor(passengers, horses);
    const crates = Math.min(slots.length, frame.demoCrates ? frame.demoCrates.length : frame.deckBoxes ?? 0);
    const manifest = deckCargoPresentation(frame.cargoManifest, crates, frame.phase === "unloading");
    const layout = `${passengers}:${horses}:${crates}:${manifest.map(box => box.ware === "coins" ? 1 : 0).join("")}`;
    if (model.crateLayout !== layout) {
      const regular: ShipDeckSlot[] = [], coins: ShipDeckSlot[] = [], heights = new Map<string, number>();
      for (let index = 0; index < crates; index++) {
        const slot = slots[index]!, key = `${slot.x}:${slot.z}`, y = heights.get(key) ?? slot.y;
        const coin = manifest[index]?.ware === "coins";
        (coin ? coins : regular).push({ ...slot, y });
        heights.set(key, y + (coin ? coinChests.height() / SAILING_SHIP_SCALE : .1125));
      }
      placeCrates(model.cargo, regular); model.coinCargo.update(coins); model.crateLayout = layout;
    }
    model.cargo.visible = finished && crates > 0;
  };
  /** The owner pirate model of a raider once loaded (its first request starts the load). */
  const pirateLook = (style: ShipStyle, id: number) => {
    if (style !== "raider" || !pirateModels) return undefined;
    pirateModels.request();
    return pirateModels.isReady() ? `pirate-${pirateShipVariant(id)}` : undefined;
  };
  /**
   * The craft of `key` in `style`; a craft whose look changed (re-liveried, other nation, pirate model
   * loaded) is rebuilt.
   */
  const craftFor = (key: string, style: ShipStyle, id: number): Craft => {
    const look = pirateLook(style, id) ?? style;
    const existing = craft.get(key);
    if (existing?.look === look) return existing;
    existing?.coinCargo.dispose(); existing?.root.removeFromParent();
    const pirate = look === style ? null : pirateModels!.craft(pirateShipVariant(id));
    return pirate ? createPirate(key, look, pirate) : create(key, style);
  };
  /** Mast flag, sail, figurehead and the construction reveal of a procedural hull. */
  const showProceduralCraft = (model: ProceduralCraft, frame: CraftFrame,
    environment: ShipVisualEnvironment, finished: boolean, boat: boolean) => {
    const livery = "livery" in frame ? frame.livery : undefined;
    const traderNation = "nation" in frame ? frame.nation : undefined;
    // Hoist the mast flag only on a finished hull; construction sites show the bare frame.
    model.flag.visible = finished;
    model.flag.material = mastFlag.material(livery);
    model.sail.material = livery ? sailCloth[livery] : materials[SHIP_STYLES[model.style].cloth];
    model.flag.rotation.y = environment.windDirection === undefined ? 0 :
      -environment.windDirection - frame.yaw;
    const fittedCloth = "cloth" in frame ? frame.cloth ?? 0 : 0;
    const boatPlanks = frame.progress >= 0.4 ? SHIPYARD_RECIPES.ships.planks : 0;
    const planks = boat ? boatPlanks : Math.round(frame.progress * SHIPYARD_RECIPES.ships.planks);
    // Every consumed plank reveals one hull slice; every consumed cloth roll reveals one sail
    // panel. The first cloth lies on deck until the mast is raised by the second.
    showCraftHull(model, finished, planks);
    model.ribs.visible = !boat && !finished && planks < SHIPYARD_RECIPES.ships.planks;
    if (model.fittings) model.fittings.visible = finished || planks >= SHIPYARD_RECIPES.ships.planks;
    model.figurehead.root.visible = finished || planks >= SHIPYARD_RECIPES.ships.planks ||
      (boat && frame.progress >= 0.4);
    model.figurehead.show(livery === "neutral" && traderNation ? undefined : livery,
      traderNation ?? environment.playerNation);
    model.rig.visible = !boat && (finished || (frame.progress >= 0.8 && fittedCloth >= SHIPYARD_MAST_CLOTH));
    model.sail.visible = finished;
    model.clothPieces.forEach((piece, index) => {
      const visible = !boat && !finished && fittedCloth >= SHIPYARD_MAST_CLOTH && index < fittedCloth;
      piece.visible = visible;
      piece.material = model.sail.material;
      if (!visible) return;
      piece.position.set(0, 0, 0);
      piece.rotation.set(0, 0, 0);
      piece.scale.setScalar(1);
    });
    model.clothRoll.visible = !boat && !finished && fittedCloth > 0 && fittedCloth < SHIPYARD_MAST_CLOTH;
    model.clothRoll.material = model.sail.material;
  };
  const update = (ships: readonly ShipFrame[], sites: readonly ShipSiteFrame[], time: number,
    environment: ShipVisualEnvironment = {}) => {
    mastFlag.update(time, environment.windStrength, environment.playerColor);
    cloth.update(time, environment.windDirection, environment.windStrength);
    piers.update(sites, time);
    lighters.update(ships, time, environment.playerNation);
    if (lighters.group.children.length) group.add(lighters.group); else lighters.group.removeFromParent();
    if (piers.group.children.length) group.add(piers.group); else piers.group.removeFromParent();
    const keys = new Set<string>();
    for (const frame of craftFrames(ships, sites)) {
      const livery = "livery" in frame ? frame.livery : undefined;
      const traderNation = "nation" in frame ? frame.nation : undefined;
      const style = shipStyleFor(livery, environment.playerNation, traderNation);
      keys.add(frame.key); const model = craftFor(frame.key, style, frame.id);
      const boat = "kind" in frame && frame.kind === "boat";
      let scale = SAILING_SHIP_SCALE;
      if (boat) scale = "scale" in frame ? frame.scale ?? 1 : 1;
      model.root.scale.setScalar(scale);
      const finished = frame.progress === 1 && !boat;
      const demo = "demoCrates" in frame && frame.demoCrates !== undefined;
      const sink = "sinkProgress" in frame ? frame.sinkProgress ?? 0 : 0;
      positionCraft(model, frame, time, finished, demo, sink);
      if ("pirate" in model) model.pirate.update(environment.zoom ?? PIRATE_NEAR_ZOOM,
        environment.windDirection === undefined ? 0 : -environment.windDirection - frame.yaw);
      else showProceduralCraft(model, frame, environment, finished, boat);
      updateCrates(model, frame, finished);
    }
    for (const [key, model] of craft) if (!keys.has(key)) {
      model.coinCargo.dispose(); group.remove(model.root); craft.delete(key);
    }
  };
  return { group, update, ready: Promise.all([premiumTextures.ready, mastFlag.ready]).then(() => undefined), dispose: () => {
    premiumTextures.dispose(); mastFlag.dispose(); figureheads.dispose();
    for (const parts of fittingParts.values()) parts.material.dispose();
    piers.dispose(); lighters.dispose(); disposeMaterials(); pirateModels?.dispose();
    craft.forEach(model => model.coinCargo.dispose()); coinChests.dispose();
    group.clear(); craft.clear(); geometries.forEach((geometry) => geometry.dispose());
    Object.values(materials).forEach((material) => material.dispose());
  } };
};
