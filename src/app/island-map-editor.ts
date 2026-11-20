import type { createCritterManager } from "../render-common/critters/critter-manager";
import type { createIslandHomes } from "../render-common/island-homes";
import { profileStep } from "../render-common/load-profile";
import type { createWorkerGroup } from "../render-common/workers/worker-group";
import { clearTerrainLightCache } from "../shared/world/lighting";
import type { createIslandAnimals } from "./island-animals";
import type { createIslandFelling } from "./island-felling";
import type { createIslandGrowth } from "./island-growth";
import { languagePreference } from "./localization/language-store";
import type { createMapEditor } from "./map-editor/map-editor";
import { type StartMap, toEditorMap } from "./map-editor/map-startup";
import type { IslandChoice } from "./map-generator/helpers";
import type { createMinimap } from "./minimap/minimap";
import type { IslandSettlement } from "./settlement/island-settlement";

type MapEditorOptions = Parameters<typeof createMapEditor>[0];
type RealMapEditor = ReturnType<typeof createMapEditor>;

interface IslandMapEditorOptions {
  animals: ReturnType<typeof createIslandAnimals>;
  builders: MapEditorOptions["builders"];
  critters: ReturnType<typeof createCritterManager>;
  felling: ReturnType<typeof createIslandFelling>;
  getSettlement: () => IslandSettlement | undefined;
  growth: ReturnType<typeof createIslandGrowth>;
  homes: ReturnType<typeof createIslandHomes>;
  islandChoice: IslandChoice;
  loadMap?: MapEditorOptions["loadMap"];
  minimap: ReturnType<typeof createMinimap>;
  onGenerateMap?: MapEditorOptions["onGenerateMap"];
  renderer: MapEditorOptions["renderer"];
  startMap: StartMap | null;
  viewport: HTMLElement;
  workers: ReturnType<typeof createWorkerGroup>;
  world: MapEditorOptions["world"];
}

/**
 * The map editor bound to the island's wildlife, trees, homes and the settlement's live reservations.
 * The editor controller and its brushes/history/React panel load only when the panel first opens; a
 * normal game session that never authors a map keeps them out of its startup and save paths.
 */
export const createIslandMapEditor = (options: IslandMapEditorOptions) => {
  const {
    animals, builders, critters, felling, getSettlement, growth, homes, islandChoice, loadMap, minimap,
    onGenerateMap, renderer, startMap, viewport, workers, world
  } = options;
  const editorMap = toEditorMap(startMap, islandChoice, world.seed);
  let real: RealMapEditor | undefined;
  let loading: Promise<RealMapEditor> | undefined;
  let disposed = false;
  let wantedEnabled = false;
  const listeners = new Set<(visible: boolean) => void>();
  const unsubscribes: (() => void)[] = [];

  const load = () => {
    if (real) return Promise.resolve(real);
    loading ??= (async () => {
      const [{ createMapEditor }, { getIslandHuntingTargets }, { regenerateSeedWorld }] = await Promise.all([
        import("./map-editor/map-editor"),
        import("./settlement/island-hunting-targets"),
        import("./map-editor/seed-generation-worker")
      ]);
      if (disposed) throw new Error("The map editor was disposed before it loaded");
      // A loaded, regenerated or pre-edited island may carry a light-surface cache from another
      // session; the editor rebuilds it from this world's heights and water on the first bake.
      clearTerrainLightCache(world);
      const invalidAuthoredAnimals = animals.manager.invalidAuthored().length;
      const editor = profileStep("map editor setup", () => createMapEditor({
        i18n: languagePreference.i18n,
        loadMap,
        onGenerateMap,
        regenerateSeedWorld,
        onEdit: () => getSettlement()?.bugReplay.unsupported("Map editor mutation: recording stopped before this edit"),
        canEditStorageTerrain: () => getSettlement()?.simulation.canEditStorageTerrain() ?? true,
        rebaseStorageTerrain: () => { getSettlement()?.simulation.rebaseStorageTerrain(); },
        animals: {
          setNav: (next) => {
            animals.manager.setNav(next);
            critters.setNav(next);
            workers.setNav(next);
          }
        },
        builders,
        map: { ...editorMap,
          loadError: [editorMap.loadError, invalidAuthoredAnimals
            ? `${invalidAuthoredAnimals} authored animals lack suitable habitat/body space. Review this draft wildlife placement before Play.` : ""]
            .filter(Boolean).join(" ") },
        onPropsRemoved: (ids) => {
          felling.removeTrees(ids);
          growth.remove(ids);
          homes.noteProps(ids);
          getSettlement()?.simulation.rebaseStorageTerrain();
        },
        generatedFeatureRuntime: () => {
          const actors = getSettlement()?.simulation.frames() ?? [];
          const reserved = new Set(actors.flatMap(actor => actor.target &&
            ["tree", "stone"].includes(actor.target.kind) ? [actor.target.id] : []));
          return {
            canMoveResource: (kind, id) => {
              if (kind === "stone" && reserved.has(-3_000_000 - id))
                return "A worker has reserved this finite stone source. Wait for that job to finish.";
              return null;
            },
            canMoveProp: id => {
              if (reserved.has(id)) return "A worker has reserved this tree or stone. Wait for that job to finish.";
              const phase = felling.getPhase(id);
              if (phase !== "removed" && phase !== "standing") return "Wait for active felling to finish before moving this tree.";
              return null;
            },
            protectedPoints: (function* () {
              for (const actor of actors) {
                if (actor.visible && actor.phase !== "retired") yield actor;
                if (actor.target) yield actor.target;
                let previous = { x: actor.x, z: actor.z };
                for (let index = actor.pathIndex; index < actor.path.length; index++) {
                  const point = actor.path[index]!, steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z)));
                  for (let step = 1; step <= steps; step++) yield {
                    x: previous.x + (point.x - previous.x) * step / steps,
                    z: previous.z + (point.z - previous.z) * step / steps
                  };
                  previous = point;
                }
              }
              for (const frame of workers.frames) { yield frame; if (frame.target) yield frame.target; }
              const pool = animals.manager.debug.pool;
              for (let id = 0; id < pool.active.length; id++) if (pool.active[id])
                yield { x: pool.x[id]!, z: pool.z[id]!, radius: 1.5 };
            })()
          };
        },
        onPropsMoved: (ids) => { felling.addTrees(ids); homes.noteProps(ids); getSettlement()?.simulation.rebaseStorageTerrain(); },
        onPropsRestored: (ids) => {
          felling.addTrees(ids);
          growth.restore(ids);
          for (const id of ids) if (world.authoredTreeAges?.[id] !== undefined &&
            !growth.isGrown(id) && !growth.isGrowing(id))
            growth.plant(id, world.authoredTreeAges[id]);
          homes.noteProps(ids);
          getSettlement()?.simulation.rebaseStorageTerrain();
        },
        onTreesPlaced: (ids) => {
          felling.addTrees(ids);
          for (const id of ids) if (world.authoredTreeAges?.[id] !== undefined)
            growth.plant(id, world.authoredTreeAges[id]);
          homes.noteProps(ids);
          getSettlement()?.simulation.rebaseStorageTerrain();
        },
        placeAnimal: animals.manager.placeAnimal,
        restoreAnimal: animals.manager.restorePlacedAnimal,
        validateAnimals: animals.manager.validateAuthored,
        getHuntingTargets: () => getIslandHuntingTargets(animals.manager),
        refreshHomes: homes.refresh,
        refreshMinimap: minimap.requestRefresh,
        relocate: (isInside) => {
          animals.manager.relocateFrom(isInside);
          workers.relocateFrom(isInside);
        },
        removeAnimal: animals.manager.removePlacedAnimal,
        renderer,
        viewport,
        visible: false,
        world
      }));
      if (disposed) { editor.dispose(); throw new Error("The map editor was disposed before it loaded"); }
      real = editor;
      if (import.meta.env.DEV) {
        window.__mapEditorStats = editor.stats;
        window.__terrainStats = editor.terrainStats;
        window.__mapHistory = editor.historyStats;
      }
      for (const listener of listeners) {
        unsubscribes.push(editor.onEnabledChange(listener));
        listener(editor.isEnabled());
      }
      if (wantedEnabled) editor.setEnabled(true);
      return editor;
    })();
    return loading;
  };

  return {
    /** Authored decoration models and the placement ghost for the editor render preview. */
    decorationFrames: () => real?.decorationFrames() ?? [],
    decorationGhost: () => real?.decorationGhost() ?? null,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      wantedEnabled = false;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      listeners.clear();
      real?.dispose();
      real = undefined;
      if (import.meta.env.DEV) {
        delete window.__mapEditorStats;
        delete window.__terrainStats;
        delete window.__mapHistory;
      }
    },
    /** Await the editor controller (standalone boot); normal play opens it lazily. */
    ensureLoaded: async () => { await load(); },
    isEnabled: () => real?.isEnabled() ?? wantedEnabled,
    isToolActive: () => real?.isToolActive() ?? false,
    onEnabledChange: (listener: (visible: boolean) => void) => {
      listeners.add(listener);
      if (real) unsubscribes.push(real.onEnabledChange(listener));
      listener(real?.isEnabled() ?? wantedEnabled);
      return () => listeners.delete(listener);
    },
    saveInput: () => real?.saveInput() ?? { animals: editorMap.animals, terrain: editorMap.terrain },
    setEnabled: (visible: boolean) => {
      wantedEnabled = visible;
      if (!visible) { real?.setEnabled(false); return; }
      void load().then(editor => editor.setEnabled(true)).catch(error => console.error("Map editor could not open", error));
    }
  };
};
