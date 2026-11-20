// oxlint-disable max-lines -- one reviewable table of the catalogue sentences in both languages.
/**
 * Sentence templates of the trigger editor (design §3.3, §13.2): an English, a Hungarian and a German template per
 * catalogue entry, `{slot}` placeholders naming the entry's slots. Events with two actor slots read the shared
 * `EVENT_PHRASINGS` (primary/inverse) instead; `{player}` there and here is the event's player filter, except in
 * events that have their own `player` slot. Catalogue vocabulary is data (like `EVENT_PHRASINGS` and the issue
 * messages), so the explain line and the blocks resolve it for any language without per-entry Lingui ids.
 */
export type SentencePair = readonly [en: string, hu: string, de: string];

export const EVENT_SENTENCES: Readonly<Record<string, SentencePair>> = {
  mapStarted: ["the map starts", "a pálya elindul", "die Karte startet"],
  elapsedTime: ["{seconds} seconds have passed", "eltelt {seconds} másodperc", "{seconds} Sekunden sind vergangen"],
  periodic: [
    "every {seconds} seconds (offset {offset})",
    "minden {seconds} másodpercben (eltolás: {offset})",
    "alle {seconds} Sekunden (Versatz {offset})"
  ],
  clockHour: ["the clock reaches hour {hour}", "az óra eléri ezt az órát: {hour}", "die Uhr erreicht Stunde {hour}"],
  calendarMoment: [
    "month {month}, day {day}, weekday {weekday} at minute {minuteUtc} (UTC)",
    "{month}. hónap, {day}. nap, {weekday}. hétnap, {minuteUtc}. perc (UTC)",
    "Monat {month}, Tag {day}, Wochentag {weekday} um Minute {minuteUtc} (UTC)"
  ],
  scriptUpdated: ["the map script is updated", "a pálya szkriptje frissül", "das Kartenskript wird aktualisiert"],
  timerExpired: ["timer {timer} expires", "lejár az időzítő: {timer}", "Timer {timer} läuft ab"],
  variableChanged: [
    "variable {variable} changes (to {equals})",
    "megváltozik a változó: {variable} (erre: {equals})",
    "Variable {variable} ändert sich (auf {equals})"
  ],
  questActivated: ["quest {quest} starts", "elindul a küldetés: {quest}", "Quest {quest} beginnt"],
  questSucceeded: ["quest {quest} succeeds", "sikerül a küldetés: {quest}", "Quest {quest} gelingt"],
  questFailed: ["quest {quest} fails", "meghiúsul a küldetés: {quest}", "Quest {quest} scheitert"],
  questClaimed: [
    "the reward of quest {quest} is claimed",
    "átveszik a küldetés jutalmát: {quest}",
    "die Belohnung von Quest {quest} wird abgeholt"
  ],
  questExpired: ["quest {quest} expires", "lejár a küldetés: {quest}", "Quest {quest} läuft ab"],
  sequenceStarted: [
    "cinematic {sequence} starts",
    "elindul az átvezető: {sequence}",
    "Zwischensequenz {sequence} beginnt"
  ],
  sequenceFinished: [
    "cinematic {sequence} finishes",
    "véget ér az átvezető: {sequence}",
    "Zwischensequenz {sequence} endet"
  ],
  sequenceSkipped: [
    "cinematic {sequence} is skipped",
    "átugorják az átvezetőt: {sequence}",
    "Zwischensequenz {sequence} wird übersprungen"
  ],
  actionOutcome: [
    "step {step} of trigger {trigger} ends with {outcome}",
    "a(z) {trigger} trigger {step} lépése így ér véget: {outcome}",
    "Schritt {step} von Trigger {trigger} endet mit {outcome}"
  ],
  playerDefeated: ["{player} is defeated", "{player} vereséget szenved", "{player} ist besiegt"],
  victoryReached: ["{player} wins", "{player} győz", "{player} gewinnt"],
  actorAppeared: [
    "{player}'s {subject} appears",
    "megjelenik {player} {subject} egysége",
    "{subject} von {player} erscheint"
  ],
  actorGone: [
    "{player}'s {subject} is gone ({reason})",
    "eltűnik {player} {subject} egysége ({reason})",
    "{subject} von {player} ist fort ({reason})"
  ],
  enteredRegion: [
    "{player}'s {subject} enters {region}",
    "{player} {subject} egysége belép ide: {region}",
    "{subject} von {player} betritt {region}"
  ],
  leftRegion: [
    "{player}'s {subject} leaves {region}",
    "{player} {subject} egysége elhagyja: {region}",
    "{subject} von {player} verlässt {region}"
  ],
  soldierPromoted: [
    "{player}'s {soldier} is promoted to rank {rank}",
    "{player} {soldier} katonája előlép ebbe a rangba: {rank}",
    "{soldier} von {player} steigt auf Rang {rank} auf"
  ],
  settlerBorn: [
    "{player}'s {settler} is born",
    "megszületik {player} {settler} telepese",
    "{settler} von {player} wird geboren"
  ],
  jobAssigned: [
    "{player}'s {settler} gets a job",
    "{player} {settler} telepese munkát kap",
    "{settler} von {player} bekommt eine Arbeit"
  ],
  toolReceived: [
    "{player}'s {settler} receives the tool {ware}",
    "{player} {settler} telepese megkapja az eszközt: {ware}",
    "{settler} von {player} erhält das Werkzeug {ware}"
  ],
  warePickedUp: [
    "{player}'s {subject} picks up {ware}",
    "{player} {subject} egysége felveszi: {ware}",
    "{subject} von {player} hebt {ware} auf"
  ],
  warePutDown: [
    "{player}'s {subject} puts down {ware}",
    "{player} {subject} egysége lerakja: {ware}",
    "{subject} von {player} legt {ware} ab"
  ],
  actorClicked: [
    "{player}'s {subject} is clicked",
    "rákattintanak {player} {subject} egységére",
    "{subject} von {player} wird angeklickt"
  ],
  scoutLooked: [
    "{player}'s {subject} looks through the spyglass",
    "{player} {subject} egysége távcsővel kémlel",
    "{subject} von {player} schaut durch das Fernrohr"
  ],
  commanderIncapacitated: [
    "{player}'s {subject} is incapacitated",
    "{player} {subject} parancsnoka harcképtelen lesz",
    "{subject} von {player} ist kampfunfähig"
  ],
  commanderRecovered: [
    "{player}'s {subject} recovers",
    "{player} {subject} parancsnoka felépül",
    "{subject} von {player} erholt sich"
  ],
  seenByPlayer: [
    "{player}'s {subject} is seen by the player",
    "a játékos meglátja {player} {subject} egységét",
    "{subject} von {player} wird vom Spieler gesehen"
  ],
  constructionPlaced: [
    "{player} places a construction site of {building}",
    "{player} építési területet jelöl ki: {building}",
    "{player} legt eine Baustelle für {building} an"
  ],
  constructionCompleted: [
    "{player}'s {building} is completed",
    "elkészül {player} {building} épülete",
    "{building} von {player} ist fertig"
  ],
  buildingUpgraded: [
    "{player}'s {building} is upgraded to level {level}",
    "{player} {building} épülete erre a szintre fejlődik: {level}",
    "{building} von {player} wird auf Stufe {level} ausgebaut"
  ],
  buildingDestroyed: [
    "{player}'s {building} is destroyed ({cause})",
    "elpusztul {player} {building} épülete ({cause})",
    "{building} von {player} wird zerstört ({cause})"
  ],
  wareProduced: [
    "{player}'s {building} produces {ware}",
    "{player} {building} épülete előállítja: {ware}",
    "{building} von {player} stellt {ware} her"
  ],
  outputPickedUp: [
    "{ware} is collected from {player}'s {building}",
    "elszállítják {player} {building} épületéből: {ware}",
    "{ware} wird aus {building} von {player} abgeholt"
  ],
  bridgeCompleted: [
    "{player}'s {bridge} is completed",
    "elkészül {player} {bridge} hídja",
    "{bridge} von {player} ist fertig"
  ],
  stockReached: [
    "the stock of {ware} reaches {amount} (in {building})",
    "a készlet ebből: {ware} eléri ezt: {amount} (itt: {building})",
    "der Vorrat an {ware} erreicht {amount} (in {building})"
  ],
  wareBought: [
    "{player} buys {ware} at the market (paying with {payment})",
    "{player} árut vásárol a piacon: {ware} (ezzel fizet: {payment})",
    "{player} kauft {ware} auf dem Markt (bezahlt mit {payment})"
  ],
  wareSold: [
    "{player} sells {ware} to a trader (for {payment})",
    "{player} árut ad el egy kereskedőnek: {ware} (ezért: {payment})",
    "{player} verkauft {ware} an einen Händler (für {payment})"
  ],
  tradeDeliveryArrived: [
    "a trade ship delivers {ware} to {player}'s {harbour} ({trade})",
    "kereskedőhajó árut hoz {player} {harbour} épületébe: {ware} ({trade})",
    "ein Handelsschiff liefert {ware} an {harbour} von {player} ({trade})"
  ],
  shipDeparted: ["{player}'s {ship} sets sail", "kifut {player} {ship} hajója", "{ship} von {player} legt ab"],
  shipStopped: ["{player}'s {ship} stops", "megáll {player} {ship} hajója", "{ship} von {player} hält an"],
  shipReachedRegion: [
    "{player}'s {ship} reaches {region}",
    "{player} {ship} hajója eléri: {region}",
    "{ship} von {player} erreicht {region}"
  ],
  wareLoaded: [
    "{ware} is loaded onto {player}'s {ship}",
    "{player} {ship} hajójára rakodnak: {ware}",
    "{ware} wird auf {ship} von {player} geladen"
  ],
  wareUnloaded: [
    "{ware} is unloaded from {player}'s {ship}",
    "{player} {ship} hajójáról kirakodnak: {ware}",
    "{ware} wird von {ship} von {player} entladen"
  ],
  shipLeftMap: [
    "{player}'s {ship} leaves the map",
    "{player} {ship} hajója elhagyja a pályát",
    "{ship} von {player} verlässt die Karte"
  ],
  shipSunk: ["{player}'s {ship} sinks", "elsüllyed {player} {ship} hajója", "{ship} von {player} sinkt"],
  treeGrowthStage: [
    "{player}'s {tree} reaches growth stage {stage}",
    "{player} {tree} fája eléri ezt a növekedési szakaszt: {stage}",
    "{tree} von {player} erreicht Wachstumsstufe {stage}"
  ],
  depositMined: [
    "{deposit} is mined (in {region})",
    "kibányásszák: {deposit} (itt: {region})",
    "{deposit} wird abgebaut (in {region})"
  ],
  shellPickedUp: ["{player} picks up {shell}", "{player} felveszi: {shell}", "{player} sammelt {shell} auf"],
  animalCollected: ["{animal} is collected", "begyűjtik: {animal}", "{animal} wird eingesammelt"],
  animalGrewUp: ["{animal} grows up", "felnő: {animal}", "{animal} wird erwachsen"],
  presentationSpawned: [
    "{player}'s {subject} appears (presentation)",
    "megjelenik {player} {subject} alakja (bemutató)",
    "{subject} von {player} erscheint (Darstellung)"
  ],
  presentationClipDone: [
    "{player}'s {subject} finishes its animation",
    "{player} {subject} alakja befejezi az animációt",
    "{subject} von {player} beendet seine Animation"
  ],
  presentationDespawned: [
    "{player}'s {subject} disappears (presentation)",
    "eltűnik {player} {subject} alakja (bemutató)",
    "{subject} von {player} verschwindet (Darstellung)"
  ],
  colonyConquered: ["the colony is conquered", "a kolóniát elfoglalják", "die Kolonie wird erobert"],
  colonyDefeated: ["the colony is defeated", "a kolónia elesik", "die Kolonie fällt"],
  colonyAbandoned: ["the colony is abandoned", "a kolóniát feladják", "die Kolonie wird aufgegeben"],
  // EAI4c computer faction events: hu/de pending (translation card).
  factionBuildingStarted: [
    "computer faction {player} starts building {building}",
    "computer faction {player} starts building {building}",
    "computer faction {player} starts building {building}"
  ],
  factionBuildingCompleted: [
    "computer faction {player} completes {building}",
    "computer faction {player} completes {building}",
    "computer faction {player} completes {building}"
  ],
  factionAttackLaunched: [
    "computer faction {player} launches an attack",
    "computer faction {player} launches an attack",
    "computer faction {player} launches an attack"
  ]
};

export const ACTION_SENTENCES: Readonly<Record<string, SentencePair>> = {
  spawn: [
    "spawn {count} {type} for {owner} at {at}",
    "létrehoz {count} egységet ({type}) neki: {owner}, itt: {at}",
    "erzeuge {count} {type} für {owner} in {at}"
  ],
  appear: ["make {actor} appear", "megjeleníti: {actor}", "lass {actor} erscheinen"],
  fade: [
    "fade {actor} over {ms} ms, then {then}",
    "elhalványítja: {actor} ({ms} ms), utána: {then}",
    "blende {actor} über {ms} ms aus, dann {then}"
  ],
  despawn: ["remove {actor}", "eltávolítja: {actor}", "entferne {actor}"],
  kill: ["kill {actor}", "megöli: {actor}", "töte {actor}"],
  killCount: [
    "kill {count} of {actor} ({order}, in {region})",
    "megöl ennyit: {count}, ezek közül: {actor} ({order}, itt: {region})",
    "töte {count} von {actor} ({order}, in {region})"
  ],
  setOwner: ["give {actor} to {owner}", "átadja: {actor}, neki: {owner}", "gib {actor} an {owner}"],
  hide: [
    "make {actor} invisible: {hidden}",
    "láthatatlan legyen-e: {actor}: {hidden}",
    "mache {actor} unsichtbar: {hidden}"
  ],
  setInvulnerable: [
    "make {actor} invulnerable: {on}",
    "sebezhetetlen legyen-e: {actor}: {on}",
    "mache {actor} unverwundbar: {on}"
  ],
  move: [
    "move {actor} to {region} ({stance})",
    "{actor} menjen ide: {region} ({stance})",
    "bewege {actor} nach {region} ({stance})"
  ],
  teleport: ["teleport {actor} to {region}", "{actor} átkerül ide: {region}", "versetze {actor} nach {region}"],
  face: [
    "turn {actor} to {angle}° or towards {target}",
    "{actor} forduljon erre: {angle}° vagy felé: {target}",
    "drehe {actor} auf {angle}° oder zu {target}"
  ],
  lookSpyglass: [
    "{actor} looks through the spyglass at {target} for {seconds} s",
    "{actor} távcsővel nézi: {target} ({seconds} mp)",
    "{actor} schaut {seconds} s durch das Fernrohr auf {target}"
  ],
  enterBuilding: ["{actor} enters {building}", "{actor} belép ide: {building}", "{actor} betritt {building}"],
  leaveBuilding: ["{actor} leaves its building", "{actor} elhagyja az épületét", "{actor} verlässt sein Gebäude"],
  boardShip: ["{actor} boards {ship}", "{actor} beszáll ide: {ship}", "{actor} geht an Bord von {ship}"],
  disembark: [
    "{actor} disembarks (at {region})",
    "{actor} kiszáll a hajóból (itt: {region})",
    "{actor} geht von Bord (in {region})"
  ],
  attack: ["{actor} attacks {target}", "{actor} megtámadja: {target}", "{actor} greift {target} an"],
  dealDamage: [
    "{actor} deals {amount} damage (to {source})",
    "{actor} {amount} sebzést okoz (neki: {source})",
    "{actor} verursacht {amount} Schaden (an {source})"
  ],
  takeDamage: [
    "{actor} takes {amount} damage (from {source})",
    "{actor} {amount} sebzést kap (tőle: {source})",
    "{actor} erleidet {amount} Schaden (von {source})"
  ],
  cutTree: ["{actor} fells {tree}", "{actor} kivágja: {tree}", "{actor} fällt {tree}"],
  pickUp: ["{actor} picks up {target}", "{actor} felveszi: {target}", "{actor} hebt {target} auf"],
  putDown: [
    "{actor} puts its load down at {region}",
    "{actor} lerakja a terhét itt: {region}",
    "{actor} legt seine Last in {region} ab"
  ],
  carryInto: [
    "{actor} carries its load into {building}",
    "{actor} beviszi a terhét ide: {building}",
    "{actor} trägt seine Last in {building}"
  ],
  loadIntoShip: [
    "{actor} loads its load onto {ship}",
    "{actor} felrakja a terhét ide: {ship}",
    "{actor} lädt seine Last auf {ship}"
  ],
  playClip: [
    "{actor} plays the animation {clip} ({loops} times)",
    "{actor} lejátssza: {clip} ({loops}×)",
    "{actor} spielt die Animation {clip} ({loops}-mal)"
  ],
  speak: [
    "{speaker} says {text} (above {actor})",
    "{speaker} mondja: {text} ({actor} fölött)",
    "{speaker} sagt {text} (über {actor})"
  ],
  release: [
    "release {actor} from script control",
    "{actor} kikerül a szkript irányítása alól",
    "gib {actor} aus der Skriptsteuerung frei"
  ],
  constructBuilding: [
    "build {actor} over {seconds} s",
    "felépíti: {actor} ({seconds} mp alatt)",
    "baue {actor} in {seconds} s"
  ],
  openDoor: [
    "set the door of {actor} open: {open}",
    "nyitva legyen-e az ajtó: {actor}: {open}",
    "Tür von {actor} offen: {open}"
  ],
  addStock: [
    "add {amount} {ware} to {actor}",
    "hozzáad {amount} egységnyit ({ware}) ide: {actor}",
    "füge {amount} {ware} zu {actor} hinzu"
  ],
  catapultTarget: ["{actor} aims at {target}", "{actor} célba veszi: {target}", "{actor} zielt auf {target}"],
  sail: ["{ship} sails to {to}", "{ship} elhajózik ide: {to}", "{ship} segelt nach {to}"],
  dock: ["{ship} docks at {harbour}", "{ship} kiköt itt: {harbour}", "{ship} legt in {harbour} an"],
  spawnAboard: [
    "put {count} {type} aboard {ship} for {owner}",
    "{count} egységet ({type}) tesz ide: {ship}, neki: {owner}",
    "setze {count} {type} für {owner} an Bord von {ship}"
  ],
  unload: [
    "{ship} unloads at {harbour} {region}",
    "{ship} kirakodik itt: {harbour} {region}",
    "{ship} entlädt in {harbour} {region}"
  ],
  sink: ["sink {ship}", "elsüllyeszti: {ship}", "versenke {ship}"],
  setWeather: [
    "set the weather to {state} over {transitionSeconds} s",
    "az időjárás legyen: {state} ({transitionSeconds} mp alatt)",
    "setze das Wetter in {transitionSeconds} s auf {state}"
  ],
  timeOfDay: ["set the hour to {hour}", "az óra legyen: {hour}", "setze die Stunde auf {hour}"],
  lightning: [
    "strike {count} lightning bolts in {region}",
    "{count} villám csap le itt: {region}",
    "lass {count} Blitze in {region} einschlagen"
  ],
  revealFog: ["reveal the fog over {region}", "felfedi a ködöt itt: {region}", "lichte den Nebel über {region}"],
  buildingAvailability: [
    "make {building} buildable: {available}",
    "építhető legyen-e: {building}: {available}",
    "{building} baubar: {available}"
  ],
  enemyWave: [
    "send the enemy wave {soldiers} ({arrival}) from {from} to {target}",
    "ellenséges hullám: {soldiers} ({arrival}), innen: {from}, ide: {target}",
    "schicke die Feindwelle {soldiers} ({arrival}) von {from} nach {target}"
  ],
  // A14-5: hu/de pending (translation card).
  setCommanderLevel: [
    "set the commander level of {faction} to {level}",
    "set the commander level of {faction} to {level}",
    "set the commander level of {faction} to {level}"
  ],
  // EAI2c: hu/de pending (translation card). The unset mode, style and level follow as "· label: [value]".
  setFactionAi: ["set the AI of {faction}", "set the AI of {faction}", "set the AI of {faction}"],
  factionAiPause: [
    "pause the AI of {faction}: {paused}",
    "pause the AI of {faction}: {paused}",
    "pause the AI of {faction}: {paused}"
  ],
  // EAI4c: hu/de pending (translation card). The unset region and seconds follow as "· label: [value]".
  setFactionGoal: [
    "set the goal of {faction} to {goal}",
    "set the goal of {faction} to {goal}",
    "set the goal of {faction} to {goal}"
  ],
  highlightRegion: ["highlight {region}: {on}", "kiemelés: {region}: {on}", "hebe {region} hervor: {on}"],
  spawnPresentation: [
    "show {type} in {region} (animation {clip}, {seconds} s)",
    "megjeleníti: {type}, itt: {region} ({clip}, {seconds} mp)",
    "zeige {type} in {region} (Animation {clip}, {seconds} s)"
  ],
  playSound: ["play the sound {cue}", "lejátssza a hangot: {cue}", "spiele den Klang {cue}"],
  playMusic: ["play the music {track}", "lejátssza a zenét: {track}", "spiele die Musik {track}"],
  stopMusic: ["stop the music", "leállítja a zenét", "stoppe die Musik"],
  playSequence: [
    "play the cinematic {sequence}",
    "lejátssza az átvezetőt: {sequence}",
    "spiele die Zwischensequenz {sequence}"
  ],
  activateQuest: ["start quest {quest}", "elindítja a küldetést: {quest}", "starte Quest {quest}"],
  completeQuest: ["complete quest {quest}", "teljesíti a küldetést: {quest}", "schließe Quest {quest} ab"],
  failQuest: ["fail quest {quest}", "meghiúsítja a küldetést: {quest}", "lass Quest {quest} scheitern"],
  resetQuest: ["reset quest {quest}", "visszaállítja a küldetést: {quest}", "setze Quest {quest} zurück"],
  setQuestVisible: [
    "make quest {quest} visible: {visible}",
    "látható legyen-e a küldetés: {quest}: {visible}",
    "Quest {quest} sichtbar: {visible}"
  ],
  enableTrigger: ["turn trigger {trigger} on", "bekapcsolja a triggert: {trigger}", "schalte Trigger {trigger} ein"],
  disableTrigger: ["turn trigger {trigger} off", "kikapcsolja a triggert: {trigger}", "schalte Trigger {trigger} aus"],
  setVariable: ["set {variable} to {value}", "{variable} legyen: {value}", "setze {variable} auf {value}"],
  increaseVariable: [
    "increase {variable} by {amount}",
    "{variable} nőjön ennyivel: {amount}",
    "erhöhe {variable} um {amount}"
  ],
  decreaseVariable: [
    "decrease {variable} by {amount}",
    "{variable} csökkenjen ennyivel: {amount}",
    "verringere {variable} um {amount}"
  ],
  arrayAppend: ["append {value} to {variable}", "{variable} végére: {value}", "hänge {value} an {variable} an"],
  arrayRemoveAt: [
    "remove item {index} of {variable}",
    "törli ezt az elemet: {index}, innen: {variable}",
    "entferne Element {index} aus {variable}"
  ],
  arrayClear: ["clear {variable}", "kiüríti: {variable}", "leere {variable}"],
  storeActor: [
    "store {selector} in {variable} ({mode})",
    "eltárolja: {selector}, ide: {variable} ({mode})",
    "speichere {selector} in {variable} ({mode})"
  ],
  timerStart: [
    "start timer {timer} for {seconds} s",
    "elindítja az időzítőt: {timer} ({seconds} mp)",
    "starte Timer {timer} für {seconds} s"
  ],
  timerPause: ["pause timer {timer}", "szünetelteti az időzítőt: {timer}", "pausiere Timer {timer}"],
  timerResume: ["resume timer {timer}", "folytatja az időzítőt: {timer}", "setze Timer {timer} fort"],
  timerStop: ["stop timer {timer}", "leállítja az időzítőt: {timer}", "stoppe Timer {timer}"],
  showMultiboard: [
    "show board {multiboard} to {audience}",
    "megmutatja a táblát: {multiboard} ({audience})",
    "zeige Tafel {multiboard} für {audience}"
  ],
  hideMultiboard: [
    "hide board {multiboard} from {audience}",
    "elrejti a táblát: {multiboard} ({audience})",
    "verberge Tafel {multiboard} vor {audience}"
  ],
  collapseMultiboard: [
    "collapse board {multiboard}",
    "összecsukja a táblát: {multiboard}",
    "klappe Tafel {multiboard} zu"
  ],
  expandMultiboard: ["expand board {multiboard}", "kinyitja a táblát: {multiboard}", "klappe Tafel {multiboard} auf"],
  sendMail: [
    "send the mail {title} to {audience}",
    "levelet küld: {title} ({audience})",
    "sende die Nachricht {title} an {audience}"
  ],
  notify: ["show the notice {text}", "értesítést mutat: {text}", "zeige die Meldung {text}"],
  grantMapReward: [
    "grant the map reward {rewards}",
    "pályajutalmat ad: {rewards}",
    "gewähre die Kartenbelohnung {rewards}"
  ],
  grantHomeReward: [
    "grant the home reward {reward}",
    "otthoni jutalmat ad: {reward}",
    "gewähre die Heimatbelohnung {reward}"
  ],
  endMap: [
    "end the map with {outcome} (story quest {storyQuest})",
    "befejezi a pályát: {outcome} (történetküldetés: {storyQuest})",
    "beende die Karte mit {outcome} (Story-Quest {storyQuest})"
  ],
  colonyEnd: ["end the colony ({reason})", "befejezi a kolóniát ({reason})", "beende die Kolonie ({reason})"],
  openUi: ["open {target} for {audience}", "megnyitja: {target} ({audience})", "öffne {target} für {audience}"],
  closeUi: ["close {target}", "bezárja: {target}", "schließe {target}"],
  highlightUi: [
    "highlight {anchor} with {text} until {until}",
    "kiemeli: {anchor}, felirat: {text}, eddig: {until}",
    "hebe {anchor} mit {text} hervor bis {until}"
  ],
  clearHighlights: ["clear every highlight", "törli az összes kiemelést", "entferne alle Hervorhebungen"],
  focusCamera: [
    "point the camera at {actor} {region}",
    "a kamera ide néz: {actor} {region}",
    "richte die Kamera auf {actor} {region}"
  ]
};

/** Flow steps (design §4.8); `{cond}` is the inline condition of `if` / `waitUntil`. */
export const FLOW_SENTENCES: Readonly<Record<string, SentencePair>> = {
  wait: ["wait {seconds} s", "vár ennyit: {seconds} mp", "warte {seconds} s"],
  waitUntil: [
    "wait until {cond} (at most {timeoutSeconds} s)",
    "vár, amíg: {cond} (legfeljebb {timeoutSeconds} mp)",
    "warte, bis {cond} (höchstens {timeoutSeconds} s)"
  ],
  if: ["if {cond}", "ha {cond}", "wenn {cond}"],
  forEach: ["for each {as} of {over}", "minden {as} elemre ebből: {over}", "für jedes {as} aus {over}"],
  forRange: ["for {as} from {from} to {to}", "{as} értéke {from}-tól {to}-ig", "für {as} von {from} bis {to}"],
  repeat: ["repeat {times} times", "ismétlés ennyiszer: {times}", "wiederhole {times}-mal"],
  runTrigger: ["run trigger {trigger}", "lefuttatja a triggert: {trigger}", "führe Trigger {trigger} aus"],
  stop: ["stop this run", "leállítja ezt a futást", "beende diesen Lauf"],
  comment: ["note: {text}", "megjegyzés: {text}", "Notiz: {text}"]
};

export const PREDICATE_SENTENCES: Readonly<Record<string, SentencePair>> = {
  actorAlive: ["{actor} is alive", "{actor} él", "{actor} lebt"],
  actorHidden: ["{actor} is invisible", "{actor} láthatatlan", "{actor} ist unsichtbar"],
  actorInRegion: ["{actor} is in {region}", "{actor} itt van: {region}", "{actor} ist in {region}"],
  actorIsType: ["{actor} is a {type}", "{actor} típusa: {type}", "{actor} ist ein {type}"],
  actorIsFamily: [
    "{actor} belongs to {family}",
    "{actor} ebbe a családba tartozik: {family}",
    "{actor} gehört zu {family}"
  ],
  actorOwnedBy: ["{actor} is owned by {player}", "{actor} gazdája: {player}", "{actor} gehört {player}"],
  actorInside: ["{actor} is inside {building}", "{actor} bent van itt: {building}", "{actor} ist in {building}"],
  actorAboard: ["{actor} is aboard {ship}", "{actor} a fedélzeten van: {ship}", "{actor} ist an Bord von {ship}"],
  actorCarrying: ["{actor} carries {ware}", "{actor} ezt viszi: {ware}", "{actor} trägt {ware}"],
  actorScripted: [
    "{actor} is under script control",
    "{actor} szkript irányítása alatt áll",
    "{actor} steht unter Skriptsteuerung"
  ],
  questIs: ["quest {quest} is {state}", "a küldetés állapota: {quest}: {state}", "Quest {quest} ist {state}"],
  triggerEnabled: ["trigger {trigger} is on", "be van kapcsolva a trigger: {trigger}", "Trigger {trigger} ist an"],
  playerDefeated: ["{player} is defeated", "{player} vereséget szenvedett", "{player} ist besiegt"],
  cinematicActive: ["a cinematic is playing", "átvezető fut", "eine Zwischensequenz läuft"],
  mapKindIs: ["the map kind is {kind}", "a pálya fajtája: {kind}", "die Kartenart ist {kind}"],
  seasonIs: ["the season is {season}", "az évszak: {season}", "die Jahreszeit ist {season}"],
  weatherIs: ["the weather is {weather}", "az időjárás: {weather}", "das Wetter ist {weather}"]
};

/** Condition rows that are not predicates. */
export const CONDITION_SENTENCES: Readonly<Record<string, SentencePair>> = {
  compare: ["{a} {op} {b}", "{a} {op} {b}", "{a} {op} {b}"],
  bool: ["{of} is true", "igaz: {of}", "{of} ist wahr"],
  all: ["all of these hold", "mind teljesül", "alle diese gelten"],
  any: ["any of these holds", "bármelyik teljesül", "eine davon gilt"],
  not: ["not:", "nem igaz:", "nicht:"]
};

export const FUNCTION_SENTENCES: Readonly<Record<string, SentencePair>> = {
  count: ["number of {selector}", "darabszám: {selector}", "Anzahl von {selector}"],
  countInRegion: [
    "number of {selector} in {region}",
    "darabszám: {selector}, itt: {region}",
    "Anzahl von {selector} in {region}"
  ],
  health: ["health of {actor}", "életerő: {actor}", "Gesundheit von {actor}"],
  healthPercent: ["health % of {actor}", "életerő %: {actor}", "Gesundheit % von {actor}"],
  owner: ["owner of {actor}", "gazdája: {actor}", "Besitzer von {actor}"],
  isAlive: ["{actor} is alive", "él: {actor}", "{actor} lebt"],
  isHidden: ["{actor} is invisible", "láthatatlan: {actor}", "{actor} ist unsichtbar"],
  typeOf: ["type of {actor}", "típusa: {actor}", "Typ von {actor}"],
  stock: ["stock of {ware} (in {building})", "készlet: {ware} (itt: {building})", "Vorrat an {ware} (in {building})"],
  buildingCount: [
    "number of {type} (level {level}, {owner})",
    "darabszám: {type} ({level}. szint, {owner})",
    "Anzahl {type} (Stufe {level}, {owner})"
  ],
  soldierCount: [
    "number of {type} (rank {rank}, {owner})",
    "darabszám: {type} ({rank}. rang, {owner})",
    "Anzahl {type} (Rang {rank}, {owner})"
  ],
  questState: ["state of quest {quest}", "küldetés állapota: {quest}", "Zustand von Quest {quest}"],
  questClaims: ["claims of quest {quest}", "küldetés átvételei: {quest}", "Abholungen von Quest {quest}"],
  elapsedSeconds: [
    "seconds since the map started",
    "a pálya kezdete óta eltelt másodpercek",
    "Sekunden seit Kartenstart"
  ],
  hour: ["the current hour", "az aktuális óra", "die aktuelle Stunde"],
  random: [
    "a random number from {min} to {max}",
    "véletlen szám {min} és {max} között",
    "eine Zufallszahl von {min} bis {max}"
  ],
  length: ["length of {variable}", "hossza: {variable}", "Länge von {variable}"],
  contains: ["{variable} contains {value}", "{variable} tartalmazza: {value}", "{variable} enthält {value}"],
  indexOf: [
    "position of {value} in {variable}",
    "helye: {value}, ebben: {variable}",
    "Position von {value} in {variable}"
  ],
  timerRemaining: ["time left on {timer}", "hátralévő idő: {timer}", "Restzeit von {timer}"],
  playerName: ["name of {player}", "neve: {player}", "Name von {player}"],
  distance: ["distance from {a} to {b}", "távolság: {a} és {b} között", "Abstand von {a} zu {b}"],
  islandName: ["the island's name", "a sziget neve", "der Name der Insel"],
  cargoCount: ["{load} aboard {ship}", "rakomány ({load}): {ship}", "{load} an Bord von {ship}"],
  capacityLeft: ["free {load} space on {ship}", "szabad hely ({load}): {ship}", "freier Platz für {load} auf {ship}"],
  // EAI4c computer faction readings: hu/de pending (translation card).
  factionBuildingCount: [
    "number of buildings of {faction} ({type})",
    "number of buildings of {faction} ({type})",
    "number of buildings of {faction} ({type})"
  ],
  factionSoldierCount: [
    "number of soldiers of {faction}", "number of soldiers of {faction}", "number of soldiers of {faction}"
  ],
  factionPosture: ["posture of {faction}", "posture of {faction}", "posture of {faction}"]
};

/** Slot names as picker titles ("Choose: the killed animal"); unknown names fall back to the name itself. */
export const SLOT_LABELS: Readonly<Record<string, SentencePair>> = {
  a: ["first value", "első érték", "erster Wert"],
  actor: ["actor", "szereplő", "Akteur"],
  amount: ["amount", "mennyiség", "Menge"],
  current: ["done so far", "eddig kész", "bisher erledigt"],
  icon: ["icon", "ikon", "Symbol"],
  anchor: ["UI anchor", "felületi horgony", "UI-Anker"],
  angle: ["angle", "szög", "Winkel"],
  animal: ["animal", "állat", "Tier"],
  arrival: ["arrival", "érkezés", "Ankunft"],
  as: ["loop name", "ciklusnév", "Schleifenname"],
  at: ["place", "hely", "Ort"],
  attachmentsInfo: ["attachments", "mellékletek", "Anhänge"],
  audience: ["audience", "címzettek", "Empfänger"],
  available: ["available", "elérhető", "verfügbar"],
  b: ["second value", "második érték", "zweiter Wert"],
  body: ["text", "szöveg", "Text"],
  bridge: ["bridge", "híd", "Brücke"],
  building: ["building", "épület", "Gebäude"],
  buildMode: ["build mode", "építési mód", "Bauart"],
  buildSeconds: ["build time", "építési idő", "Bauzeit"],
  by: ["worker", "munkás", "Arbeiter"],
  cargo: ["cargo", "rakomány", "Ladung"],
  cause: ["cause", "ok", "Ursache"],
  clearVariables: ["clear variables", "változók törlése", "Variablen leeren"],
  clip: ["animation", "animáció", "Animation"],
  cond: ["condition", "feltétel", "Bedingung"],
  count: ["count", "darab", "Anzahl"],
  cue: ["sound", "hang", "Klang"],
  day: ["day", "nap", "Tag"],
  deposit: ["deposit", "lelőhely", "Vorkommen"],
  equals: ["value", "érték", "Wert"],
  exit: ["exit", "kijárat", "Ausgang"],
  facing: ["facing", "irány", "Richtung"],
  // A14-5: hu/de pending (translation card).
  faction: ["faction", "faction", "faction"],
  // EAI4c: hu/de pending (translation card).
  goal: ["goal", "goal", "goal"],
  fadeInSeconds: ["fade in (s)", "beúsztatás (s)", "Einblenden (s)"],
  fadeMs: ["fade time", "áttűnési idő", "Blendzeit"],
  fadeOutSeconds: ["fade out (s)", "kiúsztatás (s)", "Ausblenden (s)"],
  family: ["family", "család", "Familie"],
  from: ["from", "innen", "von"],
  harbour: ["harbour", "kikötő", "Hafen"],
  hidden: ["invisible", "láthatatlan", "unsichtbar"],
  hour: ["hour", "óra", "Stunde"],
  important: ["important", "fontos", "wichtig"],
  index: ["index", "sorszám", "Index"],
  job: ["job", "foglalkozás", "Beruf"],
  killer: ["killer", "gyilkos", "Töter"],
  kind: ["kind", "fajta", "Art"],
  level: ["level", "szint", "Stufe"],
  load: ["load", "rakomány", "Ladung"],
  look: ["look", "megjelenés", "Aussehen"],
  loops: ["loops", "ismétlés", "Wiederholungen"],
  max: ["maximum", "legnagyobb", "Maximum"],
  min: ["minimum", "legkisebb", "Minimum"],
  minuteUtc: ["minute (UTC)", "perc (UTC)", "Minute (UTC)"],
  mode: ["mode", "mód", "Modus"],
  month: ["month", "hónap", "Monat"],
  ms: ["duration (ms)", "időtartam (ms)", "Dauer (ms)"],
  multiboard: ["board", "tábla", "Tafel"],
  of: ["value", "érték", "Wert"],
  offset: ["offset", "eltolás", "Versatz"],
  on: ["on", "be", "an"],
  op: ["comparison", "összehasonlítás", "Vergleich"],
  open: ["open", "nyitva", "offen"],
  order: ["order", "sorrend", "Reihenfolge"],
  outcome: ["outcome", "kimenet", "Ergebnis"],
  over: ["source", "forrás", "Quelle"],
  owner: ["owner", "gazda", "Besitzer"],
  payment: ["payment", "fizetség", "Bezahlung"],
  percent: ["percent", "százalék", "Prozent"],
  // EAI2c: hu/de pending (translation card).
  paused: ["paused", "paused", "paused"],
  pitchDeg: ["pitch", "dőlés", "Neigung"],
  player: ["player", "játékos", "Spieler"],
  prop: ["object", "tárgy", "Gegenstand"],
  quest: ["quest", "küldetés", "Quest"],
  radius: ["radius", "sugár", "Radius"],
  rank: ["rank", "rang", "Rang"],
  reason: ["reason", "ok", "Grund"],
  region: ["region", "terület", "Gebiet"],
  reward: ["reward", "jutalom", "Belohnung"],
  rewards: ["rewards", "jutalmak", "Belohnungen"],
  seconds: ["seconds", "másodperc", "Sekunden"],
  selector: ["actors", "szereplők", "Akteure"],
  sequence: ["cinematic", "átvezető", "Zwischensequenz"],
  settler: ["settler", "telepes", "Siedler"],
  shell: ["shell", "kagyló", "Muschel"],
  ship: ["ship", "hajó", "Schiff"],
  soldier: ["soldier", "katona", "Soldat"],
  soldiers: ["soldiers", "katonák", "Soldaten"],
  source: ["source", "forrás", "Quelle"],
  speaker: ["speaker", "beszélő", "Sprecher"],
  stage: ["stage", "szakasz", "Stufe"],
  stance: ["stance", "magatartás", "Haltung"],
  state: ["state", "állapot", "Zustand"],
  step: ["step", "lépés", "Schritt"],
  store: ["store in", "tárolás ide", "speichern in"],
  storyQuest: ["story quest", "történetküldetés", "Story-Quest"],
  // EAI2c: hu/de pending (translation card).
  style: ["style", "style", "style"],
  subject: ["subject", "alany", "Subjekt"],
  target: ["target", "cél", "Ziel"],
  text: ["text", "szöveg", "Text"],
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is the fade action's slot name
  then: ["then", "utána", "danach"],
  timeoutSeconds: ["timeout", "időkorlát", "Zeitlimit"],
  timer: ["timer", "időzítő", "Timer"],
  times: ["times", "ismétlések", "Wiederholungen"],
  timing: ["timing", "időzítés", "Zeitpunkt"],
  title: ["title", "cím", "Titel"],
  to: ["destination", "úti cél", "Ziel"],
  tower: ["tower", "torony", "Turm"],
  track: ["track", "zeneszám", "Musikstück"],
  trade: ["trade", "ügylet", "Handel"],
  transitionSeconds: ["transition", "átmenet", "Übergang"],
  tree: ["tree", "fa", "Baum"],
  trigger: ["trigger", "trigger", "Trigger"],
  type: ["type", "típus", "Typ"],
  until: ["until", "eddig", "bis"],
  value: ["value", "érték", "Wert"],
  variable: ["variable", "változó", "Variable"],
  victim: ["victim", "áldozat", "Opfer"],
  visible: ["visible", "látható", "sichtbar"],
  ware: ["ware", "áru", "Ware"],
  weather: ["weather", "időjárás", "Wetter"],
  weekday: ["weekday", "hétnap", "Wochentag"],
  yawDeg: ["heading", "irányszög", "Kurs"],
  volume: ["volume", "hangerő", "Lautstärke"]
};

/** Choice values (catalogue closed lists) and comparison operators. */
export const CHOICE_LABELS: Readonly<Record<string, SentencePair>> = {
  "==": ["=", "=", "="],
  "!=": ["≠", "≠", "≠"],
  "<": ["<", "<", "<"],
  "<=": ["≤", "≤", "≤"],
  ">": [">", ">", ">"],
  ">=": ["≥", "≥", "≥"],
  active: ["active", "aktív", "aktiv"],
  add: ["add", "hozzáadás", "hinzufügen"],
  auto: ["automatic", "automatikus", "automatisch"],
  autumn: ["autumn", "ősz", "Herbst"],
  blocked: ["blocked", "akadály", "blockiert"],
  boxes: ["ware boxes", "árudobozok", "Warenkisten"],
  cancelled: ["cancelled", "visszavonva", "abgebrochen"],
  captured: ["captured", "elfoglalva", "erobert"],
  claimed: ["claimed", "átvéve", "abgeholt"],
  clear: ["clear", "derült", "klar"],
  click: ["on click", "kattintásra", "bei Klick"],
  clicked: ["clicked", "kattintásig", "bis zum Klick"],
  construct: ["builds itself", "felépül", "baut sich auf"],
  consumed: ["consumed", "elfogyott", "verbraucht"],
  defeat: ["defeat", "vereség", "Niederlage"],
  defend: ["defend", "védekező", "verteidigen"],
  demolished: ["demolished", "lebontva", "abgerissen"],
  despawned: ["removed", "eltávolítva", "entfernt"],
  destroyed: ["destroyed", "elpusztítva", "zerstört"],
  died: ["died", "meghalt", "gestorben"],
  done: ["done", "kész", "fertig"],
  // A14-5 commander levels: hu/de pending (translation card).
  easy: ["easy", "easy", "easy"],
  expired: ["expired", "lejárt", "abgelaufen"],
  failed: ["failed", "meghiúsult", "gescheitert"],
  full: ["full", "tele", "voll"],
  hard: ["hard", "hard", "hard"],
  inactive: ["inactive", "inaktív", "inaktiv"],
  instant: ["at once", "azonnal", "sofort"],
  interrupted: ["interrupted", "megszakítva", "unterbrochen"],
  keep: ["keep", "megtartás", "behalten"],
  leftMap: ["left the map", "elhagyta", "Karte verlassen"],
  lost: ["lost", "elveszett", "verloren"],
  nearestTo: ["nearest", "legközelebbi", "nächste"],
  newest: ["newest", "legújabb", "neueste"],
  oldest: ["oldest", "legrégebbi", "älteste"],
  passengers: ["passengers", "utasok", "Passagiere"],
  loop: ["loop", "ismétlés", "Wiederholen"],
  medium: ["medium", "medium", "medium"],
  once: ["once", "egyszer", "einmal"],
  passive: ["passive", "passzív", "passiv"],
  purchase: ["purchase", "vásárlás", "Kauf"],
  rain: ["rain", "eső", "Regen"],
  refund: ["refund", "visszatérítés", "Rückerstattung"],
  refused: ["refused", "elutasítva", "abgelehnt"],
  remove: ["remove", "eltávolítás", "entfernen"],
  replace: ["replace", "csere", "ersetzen"],
  retired: ["retired", "kivezetve", "ausgemustert"],
  sale: ["sale", "eladás", "Verkauf"],
  seconds: ["seconds", "másodpercig", "Sekunden lang"],
  ship: ["by ship", "hajóval", "per Schiff"],
  snow: ["snow", "hó", "Schnee"],
  spring: ["spring", "tavasz", "Frühling"],
  succeeded: ["succeeded", "sikerült", "gelungen"],
  summer: ["summer", "nyár", "Sommer"],
  targetGone: ["target gone", "a cél eltűnt", "Ziel fort"],
  timeout: ["timed out", "időtúllépés", "Zeit abgelaufen"],
  unreachable: ["unreachable", "elérhetetlen", "unerreichbar"],
  victory: ["victory", "győzelem", "Sieg"],
  winter: ["winter", "tél", "Winter"],
  windowClosed: ["window closed", "ablak bezárásáig", "bis das Fenster schließt"],
  actorGone: ["actor gone", "a szereplő eltűnt", "Akteur fort"],
  home: ["home", "otthon", "Heimat"],
  adventure: ["adventure", "kaland", "Abenteuer"],
  colony: ["colony", "kolónia", "Kolonie"],
  // EAI2c faction AI modes and styles, EAI4c goals: hu/de pending (translation card).
  aggressive: ["aggressive", "aggressive", "aggressive"],
  attack: ["attack", "attack", "attack"],
  balanced: ["balanced", "balanced", "balanced"],
  develop: ["develop", "develop", "develop"],
  expand: ["expand", "expand", "expand"],
  hold: ["hold", "hold", "hold"],
  maintain: ["maintain", "maintain", "maintain"],
  none: ["none", "none", "none"],
  turtle: ["turtle", "turtle", "turtle"],
  campaign: ["campaign", "hadjárat", "Kampagne"]
};

/**
 * German wording of the shared two-actor phrasings (`EVENT_PHRASINGS` carries English and Hungarian): primary and
 * inverse, the same `{slot}` / `{player}` placeholders.
 */
export const EVENT_PHRASINGS_DE: Readonly<Record<string, readonly [primary: string, inverse: string]>> = {
  actorDamaged: [
    "{subject} von {player} wird von {source} verletzt (unter {percent}%)",
    "{source} verletzt {subject} von {player} (unter {percent}%)"
  ],
  actorKilled: ["{killer} von {player} tötet {victim}", "{victim} von {player} wird von {killer} getötet"],
  animalKilled: ["{killer} von {player} erlegt {victim}", "{victim} wird von {killer} von {player} erlegt"],
  cameNear: [
    "{subject} von {player} kommt bis auf {radius} an {target} heran",
    "{target} wird von {subject} von {player} bis auf {radius} erreicht"
  ],
  cameNearMoving: [
    "{subject} von {player} kommt bis auf {radius} an das bewegte {target} heran",
    "das bewegte {target} wird von {subject} von {player} bis auf {radius} erreicht"
  ],
  soldierRecruited: [
    "{soldier} von {player} wird in {building} rekrutiert",
    "{building} bildet {soldier} von {player} aus"
  ],
  enteredBuilding: ["{subject} von {player} betritt {building}", "{building} wird von {subject} von {player} betreten"],
  leftBuilding: ["{subject} von {player} verlässt {building}", "{building} wird von {subject} von {player} verlassen"],
  garrisoned: ["{subject} von {player} besetzt {building}", "{building} wird von {subject} von {player} besetzt"],
  leftGarrison: [
    "{subject} von {player} verlässt die Besatzung von {building}",
    "{building} verliert {subject} von {player} aus der Besatzung"
  ],
  boardedShip: ["{subject} von {player} geht an Bord von {ship}", "{ship} nimmt {subject} von {player} an Bord"],
  disembarked: ["{subject} von {player} verlässt {ship}", "{ship} lädt {subject} von {player} aus"],
  wareDelivered: [
    "{subject} von {player} liefert {ware} an {building}",
    "{building} erhält {ware} von {subject} von {player}"
  ],
  buildingOccupied: [
    "{building} von {player} wird von einem {job} bezogen",
    "ein {job} beginnt in {building} von {player} zu arbeiten"
  ],
  catapultFired: ["{tower} von {player} schießt auf {target}", "auf {target} schießt {tower} von {player}"],
  catapultHit: ["{tower} von {player} trifft {target}", "{target} wird von {tower} von {player} getroffen"],
  catapultMissed: ["{tower} von {player} verfehlt {target}", "{target} wird von {tower} von {player} verfehlt"],
  bridgeStepped: ["{subject} von {player} betritt {bridge}", "{bridge} wird von {subject} von {player} betreten"],
  shipDocked: ["{ship} von {player} legt in {harbour} an", "{harbour} empfängt {ship} von {player}"],
  actorUnloaded: [
    "{ship} von {player} setzt einen {type} in {region} ab",
    "ein {type} wird in {region} von {ship} von {player} abgesetzt"
  ],
  treeCut: ["{by} von {player} fällt {tree}", "{tree} wird von {by} von {player} gefällt"],
  treePlanted: ["{by} von {player} pflanzt {tree}", "{tree} wird von {by} von {player} gepflanzt"],
  stonePickedUp: ["{by} von {player} hebt {prop} auf", "{prop} wird von {by} von {player} aufgehoben"]
};
