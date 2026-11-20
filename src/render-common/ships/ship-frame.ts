export type ShipLivery = "enemy" | "neutral";

/** Engine-neutral native ship visuals; inventory and movement come from the naval simulation. */
export interface ShipFrame {
  id: number; x: number; y: number; z: number; yaw: number;
  /** "away" ships are beyond the map edge on a colony voyage and are not rendered. */
  phase: "idle" | "positioning" | "loading" | "sailing" | "unloading" | "stranded" | "away" | "founding" | "dismantling";
  cargoCount: number; selected?: boolean;
  /** One-time visual after removal from the fleet; never saved or restored. */
  sinkProgress?: number;
  /** Sail and flag colours of a ship that is not the player's: enemy red, neutral grey. */
  livery?: ShipLivery;
  /** Render-only nation of a visiting trader; derived from its persistent ship ID. */
  nation?: import("../workers/worker-unit").WorkerNation;
  /** Render-only, transient test crates; never economic cargo or a persisted receipt. */
  demoCrates?: readonly import("./ship-deck-layout").ShipDeckSlot[];
  /** Ware boxes on the deck now (the porters load and unload them one at a time). */
  deckBoxes?: number;
  /** Ordered transient cargo labels; canonical economic counts/capacity remain in the naval state. */
  cargoManifest?: readonly import("../../shared/settlement/ship-cargo-boxes").CargoBox[];
  /** People on the deck (boxes stand in the deck space they leave free). */
  deckPassengers?: number;
  /** This island's passenger actors in deck order, so their render poses follow the drawn hull. */
  passengers?: readonly number[];
  /**
   * The commander's horse standing on a troop ship's deck (its actor uid) and his manifest index: the deck places
   * leave room for it and the drawn horse follows the hull.
   */
  deckHorse?: { horse: number; rider: number };
  /** Active scouting receipt; only the return leg heads home. */
  exploration?: { returning: boolean };
  /** An exploration ship paused at a coast: the scout watches the island with a spyglass. */
  observing?: boolean;
  /** Seconds into the observation pause, used to play the spyglass scan from its start. */
  observationSeconds?: number;
  /**
   * Soldiers from another island aboard: not actors on this island, so they are drawn as stand-ins on
   * the deck places after the passengers' (and walk ashore over the pier at the harbour).
   */
  deckTroops?: readonly ShipDeckTroop[];
  /** The dock porters' job while the ship lies at a pier: the plan and the seconds since it began. */
  cargoWork?: ShipCargoWork;
  /** The harbour lighters working the ship at its waiting spot (NAV-03). */
  lighterWork?: ShipLighterWork;
}
interface ShipLighterWork {
  manifest?: readonly import("../../shared/settlement/ship-cargo-boxes").CargoBox[];
  /** Exact finite ferry passengers, used to choose their current population appearance. */
  passengerIds?: readonly number[];
  /** Each lighter: where it lands beside a pier, lies alongside the ship, and its carriers' way. */
  boats: import("../../shared/settlement/settlement-naval-lighters").LighterJob["boats"];
  elapsed: number;
  plan: import("../../shared/settlement/harbour-lighters").LighterPlan;
  unloading: boolean;
}
export interface ShipDeckTroop {
  rank: number; type: import("../../shared/settlement/military-combat-rules").MilitaryTroopType;
}
/** A rowing boat of the nearby harbour shuttle; render-only, derived from its saved job phase. */
export interface ShuttleBoatFrame {
  cargoManifest?: readonly import("../../shared/settlement/ship-cargo-boxes").CargoBox[];
  /** The actual claimed boatmen temporarily carry their boxes over this validated shore/deck route. */
  porterWork?: { boxes: number; crew: number; elapsed: number;
    route: readonly { x: number; z: number }[]; unloading: boolean };
  nation?: import("../workers/worker-unit").WorkerNation;
  gangway?: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
  id: number; x: number; y: number; z: number; yaw: number;
  boxes: number;
  laden: boolean;
  rowing: boolean;
}
/** A Fishery's skiff (FISHER-BOAT): parked at its launch slot, left on the ground, or afloat. */
export interface FishingBoatFrame {
  /** Render-only push/pull progress at the shoreline. */
  handling?: { kind: "launch" | "beach"; progress: number };
  /** The hauled catch lies in the boat (rowing back and beaching). */
  catch?: true;
  /** The fisher sits in it: rowing legs and the net work. */
  crewed: boolean;
  id: number;
  nation?: import("../workers/worker-unit").WorkerNation;
  /** Over water (afloat or parked): seabed height under the hull, for its soft shadow; absent on land. */
  bed?: number;
  /** 0..1 progress of the net work at the net point (cast, soak, haul); absent otherwise. */
  net?: number;
  /** The rower's population identity (the fisher's own appearance). */
  person: number;
  rowing: boolean;
  /** In the Fishery yard: on its side against a wall (`yaw` faces out of the wall, x/z on its foot). */
  stowed?: true;
  x: number; y: number; yaw: number; z: number;
}
export interface ShipCargoWork {
  manifest?: readonly import("../../shared/settlement/ship-cargo-boxes").CargoBox[];
  elapsed: number;
  plan: import("../../shared/settlement/ship-cargo-handling").CargoHandling;
  unloading: boolean;
}
export interface ShipSiteFrame {
  nation?: import("../workers/worker-unit").WorkerNation;
  id: number; x: number; y: number; z: number; yaw: number; progress: number;
  /** Cloth rolls already fitted; a sea hull raises its mast/rig only after the first two. */
  cloth?: number;
  /**
   * "dock": a loading pier beside a harbour ship; only its pier (or, at a harbour pier, its gangway) is
   * drawn, never a hull. "pier": a finished harbour's permanent pier at a berth, drawn without a ship.
   * "jetty": a dedicated narrow boat landing, drawn without a ship or gangway.
   */
  kind?: "boat" | "dock" | "jetty" | "pier"; scale?: number;
  workPier?: import("../../shared/settlement/settlement-ship-workpoint").ShipWorkpoint;
  /** Dock only: harbour door to pier foot, walked by the visual porters. */
  porterRoute?: readonly { x: number; z: number }[];
  /** Dock only: the porters' job (absent while no boxes move). */
  cargoWork?: ShipCargoWork;
}
