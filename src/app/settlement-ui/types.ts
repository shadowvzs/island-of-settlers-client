import type { I18n } from "@lingui/core";

import type { AdventureIsland } from "../../shared/settlement/adventure-rules";
import type { ColonyIsland, ColonyTroops } from "../../shared/settlement/colony-expedition-rules";
import type { FeatureStates } from "../../shared/settlement/feature-rules";
import type { ShuttleStatus } from "../../shared/settlement/harbour-shuttle-plan";
import type { IslandRole } from "../../shared/settlement/island-role";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import type { RoadVergeMode } from "../../shared/settlement/road-types";
import type {
  ColonyExpeditionPlan, ColonyExpeditionSnapshot
} from "../../shared/settlement/settlement-colony-expeditions";
import type { CommanderRecruitAvailability, CommanderSnapshot } from "../../shared/settlement/settlement-commander";
import type { FisherBoatStatus, FisherMode } from "../../shared/settlement/settlement-fisher-boat-mode";
import type { ScoutingAvailability } from "../../shared/settlement/settlement-naval-charting";
import type { ExpeditionPreparationSnapshot } from "../../shared/settlement/settlement-naval-preparation";
import type { SawmillMode } from "../../shared/settlement/settlement-sawmill-handcarts";
import type { ShippingDemandSnapshot } from "../../shared/settlement/settlement-shipping-demand";
import type { SurveyJob } from "../../shared/settlement/settlement-surveying";
import type { StoragePoolSnapshot } from "../../shared/settlement/shared-storage";
import type { WorkerPhaseSpec } from "../../shared/settlement/worker-phase-spec";
import type { MarketControls } from "../../shared/trade/market";
import type { PendingCommand } from "../components/helpers";
import type { WindowShortcut } from "../settings/window-shortcut";
import type { ShipObservationControls } from "../ship-observation";
export type SettlementRoadMode =
  | import("../../shared/settlement/road-types").RoadTier
  | RoadVergeMode
  | import("../../shared/settlement/bridge-construction").BridgeRoadMode
  | "remove"
  | null;

export interface SettlementBuildingSummary {
  displayName?: string;
  enemyCampEnclosure?: "building";
  bandit?: import("../../render-common/buildings/bandit-camp-plan").BanditSiteRef;
  enemyCampTheme?: string;
  id: string;
  type: number;
  /** Not the player's (an enemy or bandit building): no details window, a hover tooltip instead. */
  hostile?: boolean;
  /** Catapult Tower ammunition kind for new deliveries (CAT-4); absent means plain stone. */
  catapultAmmo?: import("../../shared/settlement/catapult-ammo-kinds").CatapultAmmoKind;
  status?: string;
  blockageHint?: string | null;
  worker?: string;
  productionOrders?: import("../../shared/settlement/armory-orders").ProductionOrders;
  selectedOutput?: string;
  completed?: boolean;
  construction?: {
    progress: number;
    foundationProgress: number;
    required: Readonly<Record<string, number>>;
    consumed: Readonly<Record<string, number>>;
    incoming: Readonly<Record<string, number>>;
  };
  workshopUpgrade?: { level: 0 | 1 | 2 | 3 | 4; reserved?: Record<string, number>; incoming?: Record<string, number>; requested?: true; cancelling?: true; progress?: number; builder?: number };
  upgradeAvailable?: boolean;
  upgradeBlockedReason?: string;
  upgradeSupply?: Readonly<Record<string, number>>;
  /** A harbour's berths now (1, or 2 from level 3 where the shore allows). */
  berths?: number;
  upgradeDelivered?: Readonly<Record<string, number>>;
  upgradeIncoming?: Readonly<Record<string, number>>;
  productionPaused?: boolean;
  workProgress?: number;
  workProgressLabel?: string;
  /** Read-only current worker phase, rate and honest work/travel/wait/rest classification. */
  workerPhase?: WorkerPhaseSpec;
  accepts?: Readonly<Record<string, boolean>>;
  exports?: Readonly<Record<string, boolean>>;
  canDemolish?: boolean;
  /** Stocks of this building only; realm totals live in SettlementUiSnapshot.resources. */
  inventory?: Readonly<Record<string, number>>;
  /** Immutable common stock for this owned completed depot's physical landmass. */
  storage?: StoragePoolSnapshot;
  storageCollect?: {
    visible: boolean; available: boolean; wares: readonly string[]; unavailableWares: readonly string[]; reason?: string
  };
  storageCapacity?: import("../../shared/settlement/storage-capacity").StorageCapacitySnapshot;
  /** Active settlers recruited from this storage, grouped by their current job. */
  workforce?: Readonly<Record<string, number>>;
  /** Idle settlers physically stored here, excluding assigned workers and passengers. */
  availableSettlers?: number;
  storedHandcarts?: number;
  totalHandcarts?: number;
  input?: Readonly<Record<string, number>>;
  incoming?: Readonly<Record<string, number>>;
  output?: Readonly<Record<string, number>>;
  shipyardMode?: "boats" | "ships";
  /** Sawmill: planks or hand carts. */
  sawmillMode?: SawmillMode;
  /** Selected completed Fishery: rod or boat mode, why boat is unavailable, and where its boat is. */
  fisherBoat?: FisherBoatStatus;
  farmArea?: { minX: number; minZ: number; maxX: number; maxZ: number; custom: boolean } | null;
  farmGrowing?: number;
  farmRipe?: number;
  farmWheat?: number;
  /** Flax Farm output at its own shelf. */
  farmFlax?: number;
  /** Crop the farm tends; labels its stored-output counter. */
  farmWare?: string;
  /** The active sea-ship site's consumed materials; absent before the first hull visit. */
  shipyardSite?: { cloth: number; planks: number };
  stoneArea?: { minX: number; minZ: number; maxX: number; maxZ: number; custom: boolean } | null;
  stoneOutput?: number;
  marbleRemaining?: number;
  /** Own military building on an island with storages: per-type garrison and free soldiers. */
  garrison?: SettlementGarrisonSummary;
  /** Local friendly physical reserves or assigned garrison members; focused window only. */
  soldiers?: readonly SettlementSoldierDetails[];
  /** Completed own Tavern: recruiting orders. */
  tavern?: SettlementTavernSummary;
  /** Selected Commander's Lodge: the island's commander, if it is assigned here. */
  commander?: CommanderSnapshot;
  /** Selected Commander's Lodge: paid recruitment requirements and refusal reason. */
  commanderRecruit?: CommanderRecruitAvailability;
  /** Completed own residence: what it adds to the island's population. */
  residence?: SettlementResidenceSummary;
}

export interface SettlementResidenceSummary {
  /** Seconds per settler of this residence's own timer, talent-adjusted. */
  growthSeconds: number;
  /** Where its settlers are born: the headquarters, or a colony's harbour. */
  home: "harbour" | "headquarters";
  /** People-limit bonus, talent-adjusted. */
  limitBonus: number;
  /** A population or settler-growth talent changes the values above. */
  talentAdjusted: boolean;
}

export interface SettlementSoldierDetails {
  actor: number;
  type: MilitaryTroopType;
  rank: number;
  health: number;
  maximumHealth: number;
  phase: string;
}

export interface SettlementTavernSummary {
  current: { stage: "collect" | "settler" | "train"; type: TavernTroopType } | null;
  queue: ReadonlyArray<{ count: number; type: TavernTroopType }>;
  /** Idle settlers in the island's storages. */
  freeSettlers: number;
}
type TavernTroopType = import("../../shared/settlement/military-combat-rules").MilitaryTroopType;

type GarrisonCounts = import("../../shared/settlement/military-garrison-rules").GarrisonComposition;
export interface SettlementGarrisonSummary {
  stoneStock?: number;
  stoneGround?: number;
  stoneCarried?: number;
  stoneIncoming?: number;
  catapultStatus?: import("../../shared/settlement/military-catapult").CatapultStatus;
  homeStored?: GarrisonCounts;
  minimum?: number;
  trainingFocus?: import("../../shared/settlement/settlement-military").MilitaryTrainingFocus;
  capacity: number;
  /** Local military supplies only; warehouse totals stay in `SettlementUiSnapshot.resources`. */
  coinCapacity: number;
  coinIncoming: number;
  coinStock: number;
  coinsAllowed: boolean;
  drinkCapacity: number;
  drinkIncoming: number;
  drinkStock: number;
  drinkWare: string;
  /** Archer posts on the building's towers. */
  posts: number;
  stationed: GarrisonCounts;
  /** Inside plus on their way. */
  assigned: GarrisonCounts;
  /** Physically inside soldiers per type and rank index. */
  stationedByRank: Readonly<Record<import("../../shared/settlement/military-garrison-rules").GarrisonTroop,
    readonly number[]>>;
  /** Manual counts, or null while it fills automatically. */
  manual: GarrisonCounts | null;
  /** Free soldiers in the island's storehouses, HQ and harbours. */
  stored: GarrisonCounts;
}

export interface SettlementShipSummary {
  canSink?: boolean;
  /** Durable aid identity: this neutral visitor is never counted as an owned fleet ship. */
  reliefQuestId?: string;
  /** Canonical render-frame nation/livery; visitor hull identity is never re-hashed in UI. */
  nation?: import("../../render-common/workers/worker-unit").WorkerNation;
  livery?: import("../../render-common/ships/ship-frame").ShipLivery;
  /** Real fleet ownership; absent only in authored UI snapshots. */
  owned?: boolean;
  origin?: string;
  destination?: string;
  leg?: string;
  legSeconds?: number;
  id: string;
  name: string;
  status: string;
  cargo?: string;
  wares?: Readonly<Record<string, number>>;
  passengers?: Readonly<Record<string, number>>;
  /** Embarked soldiers per troop type; they are also counted under their job in `passengers`. */
  troops?: Readonly<Partial<Record<MilitaryTroopType, number>>>;
}

export interface SettlementNotification {
  id: string;
  message: string;
  buildingId?: string;
  buildingName?: string;
  tone?: "info" | "warning";
}

/** One bridge for the bridge panel: completed, under construction, or being upgraded. */
export interface SettlementBridgeSummary {
  id: string;
  kind: import("../../shared/settlement/road-types").BridgeKind;
  /** Panel level 1–5 of the completed bridge (1 while it is still being built). */
  level: number;
  tiles: number;
  completed: boolean;
  /** Its construction (new bridge) or upgrade site. */
  site?: {
    /** Delivered so far: stock at the site plus what builders already used. */
    delivered: Readonly<Record<string, number>>;
    incoming: Readonly<Record<string, number>>;
    progress: number;
    required: Readonly<Record<string, number>>;
    stage: import("../../shared/settlement/bridge-construction").BridgeConstructionStage;
    /** Target panel level of an upgrade; absent on a new bridge. */
    upgradeTo?: number;
  };
  /** Whether the next upgrade can start, its cost and the road-connected supply. */
  upgrade: import("../../shared/settlement/bridge-upgrade-runtime").BridgeUpgradeAvailability;
  /** Remove ordered: closing to new traffic, or coming down (`progress` of the structure left). */
  removal?: { phase: "closing" | "dismantling"; progress: number };
}

export interface SettlementUiSnapshot {
  selectedBuilding?: number | null;
  focusedBuilding?: string | null;
  /** The bridge whose panel is open. */
  focusedBridge?: string | null;
  bridges?: readonly SettlementBridgeSummary[];
  roadMode?: SettlementRoadMode;
  surveyJob?: SurveyJob | null;
  resources?: Readonly<Record<string, number>>;
  /** People on the island: idle settlers plus friendly people on duty (no mounts). */
  population?: number;
  /** The island's people limit; absent on an island without a home building (an adventure). */
  populationLimit?: number;
  availableSettlers?: number;
  /** Friendly workers on duty, grouped by job (soldiers and mounts are separate). */
  workforce?: Readonly<Record<string, number>>;
  /** Friendly soldiers on this island, grouped by troop type. */
  militaryUnits?: Readonly<Partial<Record<MilitaryTroopType, number>>>;
  storedHandcarts?: number;
  totalHandcarts?: number;
  status?: string;
  statusRevision?: number;
  minimapVisible?: boolean;
  buildings?: readonly SettlementBuildingSummary[];
  ships?: readonly SettlementShipSummary[];
  seaOrders?: ReadonlyArray<{ id: number; sourceUid: number; destinationUid: number; passengers: number; expedition: boolean; exploration?: boolean }>;
  /** Nearby harbour boat service, one status per finished harbour. */
  harbourShuttles?: readonly ShuttleStatus[];
  expeditionPreparations?: readonly ExpeditionPreparationSnapshot[];
  /** Outstanding destination needs with their physical coverage or blocked reason (ISLAND-06). */
  shippingDemands?: readonly ShippingDemandSnapshot[];
  colonyExpeditions?: readonly ColonyExpeditionSnapshot[];
  /** Stored troops per type that a colony expedition can take. */
  colonyTroops?: Readonly<ColonyTroops>;
  idleExpeditionShips?: number;
  colonyTroopsByHarbour?: Readonly<Record<number, Readonly<ColonyTroops>>>;
  colonyIslands?: ReadonlyArray<ColonyIsland & { taken: boolean }>;
  /** A colony or adventure expedition is preparing or at sea; no other may start. */
  expeditionOngoing?: boolean;
  /** The island's single-player feature switches (GS4a): `gameOff` hides an entry, `mapOff` disables it. */
  features?: FeatureStates;
  /** English domain reason while the shared operation slot is held (contested colony, adventure, campaign run). */
  operationBlock?: string | null;
  colonies?: readonly SettlementColonySummary[];
  /** Adventures offered by the harbour planner (troops only). */
  adventureIslands?: readonly AdventureIsland[];
  /** Landed adventures that can be visited or abandoned. */
  adventures?: readonly SettlementAdventureSummary[];
  /** Every commander present on this island (the home planner card and destination transport card). */
  commanders?: readonly CommanderSnapshot[];
  player?: SettlementPlayerSummary;
  /** Building types this island allows; absent when every building is allowed. */
  buildableTypes?: readonly number[];
  /** Comma-joined one-off building types already built or placed (the menu shows them as built). */
  builtBuildings?: string;
  /** Offered buildings the player's level still locks, as "type:level" pairs joined by commas. */
  lockedBuildings?: string;
  /** Offered buildings the map's tier cap blocks, as "type:tier" pairs (the tier each needs). */
  tierBlockedBuildings?: string;
  /** The map's highest building/material tier (1..5) on this island. */
  buildingTierCap?: number;
  /** Home island only: whether the home sandbox unlock is on; absent on every other island. */
  homeSandbox?: boolean;
  /** Newly unlocked building types the level-up's Build button highlights, joined by commas. */
  buildHighlight?: string;
  /** Bumped by each level-up Build request: the picker reopens on the highlighted category. */
  buildHighlightRevision?: number;
  /** Colony construction menu unlocks only after conquest. */
  buildingMenuBlocked?: boolean;
  /** The settlement on screen is the player's home island (not a colony, adventure or campaign map). */
  homeIsland?: boolean;
  /** What the settlement on screen is to the player; the gem shop closes on a campaign map. */
  islandRole?: IslandRole;
  /** Expedition id of the colony on screen; null or absent on the home island. */
  activeColony?: number | null;
  playerNation?: string;
  notifications?: readonly SettlementNotification[];
}

export interface SettlementPlayerSummary {
  inventory?: import("../../shared/progression/player-inventory").PlayerInventory;
  messages?: readonly import("../../shared/progression/inbox-mails").InboxMail[];
  nation: string;
  level: number;
  experience: number;
  /** A completed home Monument gives +25 % experience (shown in the experience tooltip). */
  monumentBonus?: boolean;
  /** Game time (UTC ms) of the snapshot: the daily quest countdown runs to the next UTC midnight. */
  gameTime?: number;
  /** Experience into the current level and the size of that level (0 at the maximum level). */
  current: number;
  needed: number;
  fraction: number;
  gems: number;
  quests: readonly import("../../shared/progression/daily-quests").DailyQuest[];
  reliefQuests?: Readonly<Record<string, import("../../shared/progression/relief-quests").ReliefQuestStatus & {
    payable?: boolean; available?: number
  }>>;
  tutorial?: import("../../shared/quests/home-quests").TutorialSummary;
  questNew?: boolean;
  /** Stored amount of each quest ware on this island. */
  stock: Readonly<Record<string, number>>;
  /** What the island's rules show of the progression (plan §9.4); absent = everything, as today. */
  progression?: import("../../shared/progression/progression-rules").ProgressionVisibility;
  /** Applied talent ranks (TALENT-01); none while the island's rules switch talents off. */
  talents: import("../../shared/progression/talents").TalentRanks;
}

export interface SettlementColonySummary {
  id: number;
  island: ColonyIsland;
  status: "landed" | "contested" | "conquered" | "defeated";
  conqueredAt?: number;
  soldiers?: number;
  recallableSoldiers?: number;
  troopRecallPending?: boolean;
  troopRecallStatus?: string;
  nextResourceShipAt?: number;
  resourceShipArrivalSeconds?: number;
  incomingShips?: readonly (SettlementShipSummary & { arrivalSeconds?: number })[];
}

export interface SettlementAdventureSummary {
  id: number;
  island: AdventureIsland;
  status: "landed" | "contested" | "won" | "defeated";
}

/** What a won adventure paid: experience now, coins and wares on the reward ship. */
export interface SettlementAdventureReward { experience: number; goods: Readonly<Record<string, number>> }

export interface SettlementUiOptions {
  /** Active Lingui instance: window headings, statuses and view copy follow its locale. */
  i18n?: I18n;
  /** Game time (UTC ms): colony countdowns agree with the rules; tools without an island use device time. */
  gameNow?: () => number;
  mount?: HTMLElement;
  onSelectBuilding: (id: number | null) => void;
  onRotate: () => void;
  onRoadMode: (mode: SettlementRoadMode) => void;
  onSettings: () => void;
  /** Main selection window shortcuts after its entries (Music player, Credits, Game News). */
  menuShortcuts?: readonly WindowShortcut[];
  onOpenInventory?: (opener?: HTMLElement) => void;
  onMinimap: () => void;
  onOverview?: () => void;
  onShips?: () => void;
  onSurveyJob?: (job: SurveyJob | null) => void;
  onShipyardMode?: (uid: number, mode: "boats" | "ships") => boolean | void;
  onSawmillMode?: (uid: number, mode: SawmillMode) => boolean | void;
  onFisherMode?: (uid: number, mode: FisherMode) => boolean | void;
  onQueueTransport?: (
    source: number,
    destination: number,
    goods: Readonly<Record<string, number>>
  ) => boolean | void;
  onCancelSeaTransport?: (id: number) => boolean;
  onSinkShip?: (id: string) => boolean;
  onQueuePassengers?: (source: number, destination: number, helpers: number, soldiers: number) => boolean;
  onExpeditionTargets?: (source: number) => Array<{ x: number; z: number; rotation: number }>;
  /** Discovered harbour spots, one per island, offered as potential settlements. */
  onPotentialSettlements?: (source: number) => Array<{ x: number; z: number; rotation: number }>;
  /** Domain availability: visibility/readiness only, never hidden site coordinates or counts. */
  onScoutingAvailability?: (source: number) => ScoutingAvailability;
  onQueueExploration?: (source: number) => boolean;
  onQueueExpedition?: (source: number, target: { x: number; z: number; rotation: number }) => boolean;
  onPlanColony?: (source: number, island: number, troops: Readonly<ColonyTroops>,
    commanderId?: string) => ColonyExpeditionPlan;
  onMilitaryTrainingFocus?: (uid: number, focus: "balanced" | "elite") => boolean;
  onMilitaryCoins?: (uid: number, allowed: boolean) => boolean | void;
  /** Catapult Tower: chooses the kind of the next deliveries (CAT-4). */
  onCatapultAmmo?: (uid: number, kind: import("../../shared/settlement/catapult-ammo-kinds").CatapultAmmoKind) => boolean;
  /** Commander's Lodge: pays the canonical recipe and creates the island's commander. */
  onRecruitCommander?: (uid: number, definitionId?: string) => true | string;
  /** Administrator development tool; the simulation refuses unauthorized callers. */
  onCommanderLevelUp?: (uid: number) => true | string;
  onGarrisonComposition?: (uid: number, counts: GarrisonCounts | null) => boolean;
  onStartColony?: (source: number, island: number, troops: Readonly<ColonyTroops>,
    commanderId?: string) => true | string;
  onCancelColony?: (id: number) => boolean;
  onOpenColonyPlanner?: (source: number) => void;
  onPlanAdventure?: (source: number, island: number, troops: Readonly<ColonyTroops>,
    commanderId?: string) => ColonyExpeditionPlan;
  /** Returns true when started, otherwise the reason it cannot start. */
  onStartAdventure?: (source: number, island: number, troops: Readonly<ColonyTroops>,
    commanderId?: string) => true | string;
  onOpenAdventurePlanner?: (source: number) => void;
  /** Colony/adventure: sends the deployed commander to a real return ship. */
  onReturnCommander?: () => true | string;
  /** Opens the harbour's trade office (set by the settlement UI when `trade` is given). */
  onOpenTradeOffice?: (harbour: number) => void;
  /** Experience, coins and wares an offered adventure would pay at the player's level. */
  onAdventureReward?: (island: AdventureIsland) => SettlementAdventureReward & { perLevel: number };
  onVisitColony?: (id: number) => void;
  onReturnHome?: () => void;
  onDisbandColony?: (id: number) => void;
  onRecallColonySoldiers?: (id: number) => void;
  /** Delivers or claims a daily quest; true, or the reason it cannot be completed yet. */
  onReadMessage?: (id: string) => void;
  onCompleteQuest?: (id: string) => PendingCommand;
  onSkipTutorial?: (id: string) => true | string;
  onTutorialOpened?: () => void;
  onShowTutorial?: (id: string) => void;

  /** Buys a gem shop offer into the home storage; true, or the reason it was refused. */
  onBuyGemOffer?: (id: string) => PendingCommand;
  /** Talents window: applies the pending tree; true or the refusal reason. */
  onApplyTalents?: (ranks: import("../../shared/progression/talents").TalentRanks) => true | string;
  /** Talents window: takes back every applied point for gems; true or the refusal reason. */
  onResetTalents?: () => PendingCommand;
  onProductionPaused?: (uid: number, paused: boolean) => boolean | void;
  onStorageCollect?: (uid: number, ware: string, enabled: boolean) => boolean | void;
  onProductionOrder?: (uid: number, ware: string, amount: number | null) => boolean | void;
  /** Orders Tavern recruits; true, or the reason (e.g. missing ingredients) it was refused. */
  onTavernRecruit?: (uid: number, type: import("../../shared/settlement/military-combat-rules").MilitaryTroopType,
    count: number) => true | string;
  onProductionMode?: (uid: number, ware: string) => boolean | void;
  onWorkshopUpgrade?: (uid: number, cancel: boolean) => boolean;
  /** Home sandbox (no penalty): every building and level opens on the home island; false when refused. */
  onHomeSandbox?: (enabled: boolean) => boolean;
  onDemolishBuilding?: (uid:number) => boolean;
  onFocusBuilding?: (id: string) => void;
  /** Camera focus on a building without selecting it (script details focus, rev M16: no recorded `select`). */
  onFocusBuildingCamera?: (id: string) => void;
  onCloseBuilding?: () => void;
  /** Removes a bridge or its construction site (journalled); true when it was removed. */
  onRemoveBridge?: (id: number) => boolean;
  /** Requests (or cancels) the next bridge upgrade; true when accepted. */
  onBridgeUpgrade?: (id: number, cancel: boolean) => boolean;
  /** The bridge panel opened on this bridge (the renderer keeps its outline). */
  onFocusBridge?: (id: number) => void;
  onCloseBridge?: () => void;
  onFocusShip?: (id: string) => void;
  shipObservation?: ShipObservationControls;
  shipDeckPreview?: import("../settlement/ship-demo").ShipDeckPreviewControls;
  /** Troop ships (military controls §9.3): the ship window's troop panel and the selected ship's map orders. */
  shipTroops?: import("./ship-register/troop-types").ShipTroopPort;
  /** The island's trade office (TRADE-01): queries and `true | string` commands of the simulation. */
  trade?: import("./trade-office/types").SettlementTradeOffice;
  /** The account's server-backed Player Market; absent for guests and offline play. */
  market?: MarketControls;
  /** Campaign departures from the home island (C8); absent where the session offers none. */
  campaign?: import("./campaign-window/types").CampaignWindowPort;
}

export interface SettlementUi {
  /** Closes every ordinary settlement window/panel (presentation modes). */
  closeWindows: () => void;
  root: HTMLElement;
  announceColony: (
    status: "conquered" | "defeated", island: ColonyIsland, id: number, experience?: number
  ) => void;
  announceAdventure: (status: "won" | "defeated", island: AdventureIsland, reward?: SettlementAdventureReward) => void;
  announceLevelUp: (levelUps: readonly import("../../shared/progression/player-progress").LevelUp[]) => void;
  focusBuilding: (id: string | number) => void;
  /** Map script windows (TRG9): openers, bring-to-front and close, including the UI-only building details. */
  scriptWindows: import("./script-windows").SettlementScriptWindows;
  /** Opens the bridge panel on a bridge (completed or under construction). */
  focusBridge: (id: number) => void;
  focusShip: (id: string | number) => void;
  /** The island is shown (loading finished): the HUD's React content may load. */
  onIslandShown: () => void;
  /** Any other modal question over the island (cloud save conflict, session taken over). */
  showPopup: (content: import("./settlement-popup").SettlementPopupContent) => void;
  update: (snapshot: SettlementUiSnapshot) => void;
  dispose: () => void;
}
