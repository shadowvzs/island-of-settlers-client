import { msg } from "@lingui/core/macro";

/**
 * Tutorial quest and chapter copy from shared progression data. A build/produce step has no stored
 * title: its complete title is one of the three templates below, with the building or ware inserted
 * as a named value. Every other title is listed by step id.
 */
export const QUEST_CATALOG_MESSAGES = {
  supplyWhy: msg({ id: "domain.tutorial.supplyWhy", message: "Replenish supplies before expanding the settlement." }),
  defaults: {
    buildBenefit: msg({
      id: "domain.tutorial.default.buildBenefit",
      message: "A permanent addition to your settlement's economy."
    }),
    deliverBenefit: msg({
      id: "domain.tutorial.default.deliverBenefit",
      message: "The villagers remember who supplied them."
    }),
    deliverTips: msg({
      id: "domain.tutorial.default.deliverTips",
      message: "Keep the wares in your storage. Claiming the quest takes them from your stock."
    }),
    eventBenefit: msg({
      id: "domain.tutorial.default.eventBenefit",
      message: "Learn a service your settlement can keep using."
    }),
    eventTips: msg({
      id: "domain.tutorial.default.eventTips",
      message: "Complete this action after the quest unlocks."
    }),
    produceBenefit: msg({
      id: "domain.tutorial.default.produceBenefit",
      message: "A reliable supply for the next production chain."
    }),
    produceTips: msg({
      id: "domain.tutorial.default.produceTips",
      message: "Production counts from the moment this tutorial unlocks. Stored or purchased goods are not new production."
    })
  },
  chapter: {
    1: msg({ id: "domain.tutorial.chapter.1", message: "Timber" }),
    2: msg({ id: "domain.tutorial.chapter.2", message: "Planks, stone and homes" }),
    3: msg({ id: "domain.tutorial.chapter.3", message: "Water and fishing" }),
    4: msg({ id: "domain.tutorial.chapter.4", message: "Fields and hunting" }),
    5: msg({ id: "domain.tutorial.chapter.5", message: "Grain and flax" }),
    6: msg({ id: "domain.tutorial.chapter.6", message: "Bread and cloth" }),
    7: msg({ id: "domain.tutorial.chapter.7", message: "Livestock" }),
    8: msg({ id: "domain.tutorial.chapter.8", message: "Meat and hides" }),
    9: msg({ id: "domain.tutorial.chapter.9", message: "Leather" }),
    10: msg({ id: "domain.tutorial.chapter.10", message: "Plantations and homes" }),
    11: msg({ id: "domain.tutorial.chapter.11", message: "Drinks" }),
    12: msg({ id: "domain.tutorial.chapter.12", message: "Surveying and mines" }),
    13: msg({ id: "domain.tutorial.chapter.13", message: "Smelting and stone" }),
    14: msg({ id: "domain.tutorial.chapter.14", message: "Tools" }),
    15: msg({ id: "domain.tutorial.chapter.15", message: "Arms and armour" }),
    16: msg({ id: "domain.tutorial.chapter.16", message: "Recruitment" }),
    17: msg({ id: "domain.tutorial.chapter.17", message: "Territory defence" }),
    18: msg({ id: "domain.tutorial.chapter.18", message: "Harbour and trade" }),
    19: msg({ id: "domain.tutorial.chapter.19", message: "Gold and expansion" }),
    20: msg({ id: "domain.tutorial.chapter.20", message: "A growing settlement" }),
    21: msg({ id: "domain.tutorial.chapter.21", message: "Coins and training" }),
    22: msg({ id: "domain.tutorial.chapter.22", message: "Archers and advanced materials" }),
    23: msg({ id: "domain.tutorial.chapter.23", message: "Veteran army" }),
    24: msg({ id: "domain.tutorial.chapter.24", message: "Siege defence" }),
    25: msg({ id: "domain.tutorial.chapter.25", message: "Fortress and expeditions" }),
    26: msg({ id: "domain.tutorial.chapter.26", message: "Master builders" }),
    27: msg({ id: "domain.tutorial.chapter.27", message: "Consolidating supply" }),
    28: msg({ id: "domain.tutorial.chapter.28", message: "Finest materials" }),
    29: msg({ id: "domain.tutorial.chapter.29", message: "Preparing a landmark" }),
    30: msg({ id: "domain.tutorial.chapter.30", message: "National landmark" })
  },
  quests: {
    "army.commander-lodge": {
      why: msg({ id:"domain.tutorial.quest.army.commander-lodge.why",message:"A Commander's Lodge recruits and rests your settlement's commander." }),
      tips: msg({ id:"domain.tutorial.quest.army.commander-lodge.tips",message:"Connect the lodge to storage and prepare coins, beer and your national drink." })
    },
    "army.catapult-tower": {
      why: msg({ id:"domain.tutorial.quest.army.catapult-tower.why",message:"A Catapult Tower supports your defenders with stone projectiles." }),
      tips: msg({ id:"domain.tutorial.quest.army.catapult-tower.tips",message:"Connect its entrance to storage. Its dedicated carrier brings stones up to the crew." })
    },
    "settlers.big-residence": {
      why: msg({ id: "domain.tutorial.quest.settlers.big-residence.why", message: "More homes support a larger settlement." }),
      tips: msg({ id: "domain.tutorial.quest.settlers.big-residence.tips", message: "Connect the residence to the road network." })
    },
    "landmark.monument": {
      why: msg({ id: "domain.tutorial.quest.landmark.monument.why", message: "Celebrate your settlement with its national landmark." }),
      tips: msg({ id: "domain.tutorial.quest.landmark.monument.tips", message: "Gather the finest construction materials before building." })
    },
    "army.armour": {
      why: msg({ id: "domain.tutorial.army.armour.why", message: "Keep armour ready for recruitment." })
    },
    "army.barracks": {
      tips: msg({
        id: "domain.tutorial.army.barracks.tips",
        message: "Place it inside your territory and connect a road."
      }),
      why: msg({
        id: "domain.tutorial.army.barracks.why",
        message: "A Barracks garrisons soldiers and claims more land."
      })
    },
    "army.fortress": {
      tips: msg({
        id: "domain.tutorial.army.fortress.tips",
        message: "It holds ten soldiers; place it where your territory needs defending."
      }),
      why: msg({
        id: "domain.tutorial.army.fortress.why",
        message: "The Fortress is your strongest garrison and claims the most land."
      })
    },
    "army.garrison": {
      benefit: msg({
        id: "domain.tutorial.army.garrison.benefit", message: "A defended, larger settlement."
      }),
      tips: msg({
        id: "domain.tutorial.army.garrison.tips", message: "Assign three soldiers to military buildings."
      }),
      title: msg({ id: "domain.tutorial.army.garrison.title", message: "Garrison soldiers" }),
      why: msg({
        id: "domain.tutorial.army.garrison.why",
        message: "A staffed building claims new land beyond your headquarters."
      })
    },
    "army.garrison-five": {
      benefit: msg({
        id: "domain.tutorial.army.garrison.benefit", message: "A defended, larger settlement."
      }),
      tips: msg({
        id: "domain.tutorial.army.garrisonFive.tips",
        message: "Assign five soldiers to military buildings; the Barracks and Guardhouse hold them."
      }),
      title: msg({ id: "domain.tutorial.army.garrisonFive.title", message: "Garrison five soldiers" }),
      why: msg({
        id: "domain.tutorial.army.garrisonFive.why",
        message: "A staffed garrison claims and defends more land."
      })
    },
    "army.garrison-six": {
      benefit: msg({
        id: "domain.tutorial.army.garrisonSix.benefit", message: "A stronger defence before the last expansion."
      }),
      tips: msg({
        id: "domain.tutorial.army.garrisonSix.tips",
        message: "Station six soldiers across the Barracks, Guardhouse and Watchtower."
      }),
      title: msg({ id: "domain.tutorial.army.garrisonSix.title", message: "Garrison six soldiers" }),
      why: msg({
        id: "domain.tutorial.army.garrisonSix.why",
        message: "A full garrison protects the territory around your Fortress site."
      })
    },
    "army.guardhouse": {
      tips: msg({
        id: "domain.tutorial.army.guardhouse.tips",
        message: "Connect roads so stored soldiers can join its garrison."
      }),
      why: msg({
        id: "domain.tutorial.army.guardhouse.why",
        message: "Military buildings defend and extend your territory."
      })
    },
    "army.hides": {
      why: msg({
        id: "domain.tutorial.army.hides.why",
        message: "Collect hides for tanning. Pause the Slaughterhouse if pigs run short."
      })
    },
    "army.leather": {
      why: msg({ id: "domain.tutorial.army.leather.why", message: "Prepare leather for armour crafting." })
    },
    "army.leatherworks": {
      tips: msg({ id: "domain.tutorial.army.leatherworks.tips", message: "Deliver leather and cloth to the Leatherworks." }),
      why: msg({ id: "domain.tutorial.army.leatherworks.why", message: "Every recruit needs armour." })
    },
    "army.recruit": {
      title: msg({ id: "domain.tutorial.army.recruit.title", message: "Recruit soldiers" }),
      why: msg({
        id: "domain.tutorial.army.recruit.why", message: "A small army protects your economy and territory."
      })
    },
    "army.recruit-more": {
      tips: msg({
        id: "domain.tutorial.army.recruitMore.tips",
        message: "A shield bearer needs a settler, a sword, a shield, armour and beer."
      }),
      title: msg({ id: "domain.tutorial.army.recruit.title", message: "Recruit soldiers" }),
      why: msg({
        id: "domain.tutorial.army.recruitMore.why",
        message: "More soldiers are needed for the coming campaign."
      })
    },
    "army.recruit-two": {
      tips: msg({
        id: "domain.tutorial.army.recruitTwo.tips",
        message: "A shield bearer needs a settler, a sword, a shield, armour and beer."
      }),
      title: msg({ id: "domain.tutorial.army.recruit.title", message: "Recruit soldiers" }),
      why: msg({
        id: "domain.tutorial.army.recruitTwo.why",
        message: "A larger army is needed to expand your territory."
      })
    },
    "army.skinner": {
      tips: msg({ id: "domain.tutorial.army.skinner.tips", message: "The Skinner takes pigs from storage." }),
      why: msg({ id: "domain.tutorial.army.skinner.why", message: "Hides start the armour chain." })
    },
    "army.tannery": {
      tips: msg({
        id: "domain.tutorial.army.tannery.tips", message: "Supply hides and planks to the Tannery."
      }),
      why: msg({ id: "domain.tutorial.army.tannery.why", message: "Leather is needed for armour." })
    },
    "army.tavern": {
      tips: msg({
        id: "domain.tutorial.army.tavern.tips",
        message: "A shield bearer needs a settler, a sword, a shield, armour and beer."
      }),
      why: msg({ id: "domain.tutorial.army.tavern.why", message: "The Military Academy recruits your soldiers." })
    },
    "drink.craft": {
      why: msg({ id: "domain.tutorial.drink.craft.why", message: "A drink supply serves quests and trade." })
    },
    "drink.maker": {
      tips: msg({
        id: "domain.tutorial.drink.maker.tips", message: "Deliver the plantation's raw ingredient and water."
      }),
      why: msg({
        id: "domain.tutorial.drink.maker.why",
        message: "Craft your nation's drink, a ware for quests and trade."
      })
    },
    "drink.plantation": {
      tips: msg({
        id: "domain.tutorial.drink.plantation.tips",
        message: "Leave planting ground nearby. Plantations take no input wares."
      }),
      why: msg({
        id: "domain.tutorial.drink.plantation.why",
        message: "Your nation's plantation supplies its traditional drink ingredient."
      })
    },
    "drink.raw": {
      why: msg({
        id: "domain.tutorial.drink.raw.why", message: "Harvest the raw ingredient for your nation's drink."
      })
    },
    "food.bakery": {
      tips: msg({ id: "domain.tutorial.food.bakery.tips", message: "The Bakery needs flour and water." }),
      why: msg({ id: "domain.tutorial.food.bakery.why", message: "Bread is a reliable food for miners." })
    },
    "food.beer": {
      why: msg({ id: "domain.tutorial.food.beer.why", message: "Set aside beer for your first recruits." })
    },
    "food.bread": {
      why: msg({ id: "domain.tutorial.food.bread.why", message: "Bread keeps mines working." })
    },
    "food.bread-delivery": {
      why: msg({
        id: "domain.tutorial.food.breadDelivery.why",
        message: "Fresh bread feeds the village at its feast."
      })
    },
    "food.cloth": {
      why: msg({ id: "domain.tutorial.food.cloth.why", message: "Cloth is required to rig sea ships." })
    },
    "food.flax": {
      tips: msg({
        id: "domain.tutorial.food.flax.tips",
        message: "Leave open, dry field ground around the Flax Farm. The grower hand-pulls and dries the fibre."
      }),
      why: msg({
        id: "domain.tutorial.food.flax.why",
        message: "Flax is the first step towards sailcloth and sea ships."
      })
    },
    "food.flax-fibre": {
      why: msg({
        id: "domain.tutorial.food.flaxFibre.why",
        message: "Flax fibre feeds the Weaver's loom."
      })
    },
    "food.weaver": {
      tips: msg({
        id: "domain.tutorial.food.weaver.tips",
        message: "Supply two flax per cloth through road-connected storage."
      }),
      why: msg({
        id: "domain.tutorial.food.weaver.why",
        message: "The Weaver turns flax fibre into cloth for sails and trade."
      })
    },
    "food.brewery": {
      tips: msg({ id: "domain.tutorial.food.pigs.tips", message: "Supply grain and water." }),
      why: msg({ id: "domain.tutorial.food.brewery.why", message: "Every recruit needs beer." })
    },
    "food.farm": {
      tips: msg({
        id: "domain.tutorial.food.farm.tips", message: "Leave open ground around the Farm for fields."
      }),
      why: msg({ id: "domain.tutorial.food.farm.why", message: "Grain feeds the food chain." })
    },
    "food.fish": {
      why: msg({
        id: "domain.tutorial.food.fish.why", message: "A coastal food supply supports mining."
      })
    },
    "food.fishery": {
      tips: msg({
        id: "domain.tutorial.food.fishery.tips", message: "Choose a clear fishing shore and connect a road."
      }),
      why: msg({ id: "domain.tutorial.food.fishery.why", message: "Fish feeds your miners later on." })
    },
    "food.grain": {
      why: msg({
        id: "domain.tutorial.food.grain.why", message: "Grain feeds mills, pig farms and breweries."
      })
    },
    "food.hunter": {
      tips: msg({
        id: "domain.tutorial.food.hunter.tips", message: "Place near wildlife. Animals return after five minutes."
      }),
      why: msg({ id: "domain.tutorial.food.hunter.why", message: "Meat is another early food for miners." })
    },
    "food.meat": {
      why: msg({
        id: "domain.tutorial.food.meat.why", message: "Feed the first mines without a farming chain."
      })
    },
    "food.mill": {
      tips: msg({ id: "domain.tutorial.food.mill.tips", message: "Supply grain to the Mill." }),
      why: msg({ id: "domain.tutorial.food.mill.why", message: "Flour is the Bakery's main ingredient." })
    },
    "food.pigs": {
      tips: msg({ id: "domain.tutorial.food.pigs.tips", message: "Supply grain and water." }),
      why: msg({
        id: "domain.tutorial.food.pigs.why", message: "Pig farms produce livestock without wild game."
      })
    },
    "food.pigs-raised": {
      why: msg({
        id: "domain.tutorial.food.pigsRaised.why", message: "Raised pigs keep the Slaughterhouse supplied."
      })
    },
    "food.pigs-second": {
      tips: msg({
        id: "domain.tutorial.food.pigsSecond.tips", message: "Supply grain and water to the new Pig breeder."
      }),
      why: msg({
        id: "domain.tutorial.food.pigsSecond.why",
        message: "A second Pig breeder turns more grain into livestock."
      })
    },
    "food.slaughterhouse": {
      tips: msg({
        id: "domain.tutorial.food.slaughterhouse.tips",
        message: "Connect it to the Pig farm and storage."
      }),
      why: msg({
        id: "domain.tutorial.food.slaughterhouse.why",
        message: "Turn pigs into a steady meat supply."
      })
    },
    "food.well": {
      tips: msg({
        id: "domain.tutorial.food.well.tips",
        message: "Deliver water through your road-connected storage network."
      }),
      why: msg({
        id: "domain.tutorial.food.well.why",
        message: "Water is an input for bread, drinks and livestock."
      })
    },
    "granite.mine": {
      tips: msg({
        id: "domain.tutorial.granite.mine.tips",
        message: "Survey a granite deposit and deliver food."
      }),
      why: msg({
        id: "domain.tutorial.granite.mine.why",
        message: "Granite deposits replace exhausted surface rock."
      })
    },
    "granite.output": {
      why: msg({
        id: "domain.tutorial.granite.output.why",
        message: "Keep construction supplied when surface stone is gone."
      })
    },
    "mine.armory": {
      tips: msg({
        id: "domain.tutorial.mine.armory.tips",
        message: "Supply iron and coal and select the weapon you need."
      }),
      why: msg({ id: "domain.tutorial.mine.armory.why", message: "Weapons equip new soldiers." })
    },
    "mine.bows": {
      why: msg({
        id: "domain.tutorial.mine.bows.why",
        message: "Bows equip archers for tower and field defence."
      })
    },
    "mine.charcoal": {
      why: msg({ id: "domain.tutorial.mine.charcoal.why", message: "Keep the metal chain supplied." })
    },
    "mine.charburner": {
      tips: msg({
        id: "domain.tutorial.mine.charburner.tips",
        message: "Supply logs and grain and leave working space."
      }),
      why: msg({
        id: "domain.tutorial.mine.charburner.why",
        message: "Charcoal provides coal when deposits run short."
      })
    },
    "mine.coal": {
      tips: msg({
        id: "domain.tutorial.mine.coal.tips",
        message: "Build on a surveyed coal deposit and provide food."
      }),
      why: msg({ id: "domain.tutorial.mine.coal.why", message: "Coal fuels the metal chain." })
    },
    "mine.iron": {
      tips: msg({
        id: "domain.tutorial.mine.iron.tips",
        message: "Build on a surveyed iron deposit; deliver food."
      }),
      why: msg({
        id: "domain.tutorial.mine.iron.why",
        message: "Iron ore is the raw material for tools and weapons."
      })
    },
    "mine.iron-output": {
      why: msg({
        id: "domain.tutorial.mine.ironOutput.why",
        message: "Usable iron feeds tools and weapons."
      })
    },
    "mine.metalworks": {
      tips: msg({
        id: "domain.tutorial.mine.metalworks.tips",
        message: "Set tool priorities in the building's panel; pickaxes and bows run short first."
      }),
      why: msg({
        id: "domain.tutorial.mine.metalworks.why",
        message: "Tools let you assign workers to more occupations."
      })
    },
    "mine.shields": {
      why: msg({
        id: "domain.tutorial.mine.shields.why", message: "Shields keep your soldiers alive in melee."
      })
    },
    "mine.smelter": {
      tips: msg({
        id: "domain.tutorial.mine.smelter.tips", message: "Supply iron ore and coal."
      }),
      why: msg({
        id: "domain.tutorial.mine.smelter.why",
        message: "Iron turns mined ore into usable metal."
      })
    },
    "mine.survey": {
      title: msg({ id: "domain.tutorial.mine.survey.title", message: "Survey an ore deposit" }),
      why: msg({
        id: "domain.tutorial.mine.survey.why",
        message: "A Geologist reveals deposits where mines can work."
      })
    },
    "mine.swords": {
      why: msg({
        id: "domain.tutorial.mine.swords.why", message: "Equip swordsmen for your defence."
      })
    },
    "mine.tools": {
      title: msg({ id: "domain.tutorial.mine.tools.title", message: "Produce tools" }),
      why: msg({
        id: "domain.tutorial.mine.tools.why", message: "Every new specialist needs the right tool."
      })
    },
    "mine.tools-reserve": {
      tips: msg({
        id: "domain.tutorial.mine.toolsReserve.tips",
        message: "Set tool priorities in the Metalworks; pickaxes and bows run short first."
      }),
      title: msg({ id: "domain.tutorial.mine.tools.title", message: "Produce tools" }),
      why: msg({
        id: "domain.tutorial.mine.toolsReserve.why",
        message: "Keep tools ready for new specialists and military production."
      })
    },
    "rank.archers": {
      benefit: msg({
        id: "domain.tutorial.rank.archers.benefit", message: "Protected ranged defence."
      }),
      tips: msg({
        id: "domain.tutorial.rank.archers.tips",
        message: "Station two archers in military buildings. The Armory makes bows when the starting ones are gone."
      }),
      title: msg({ id: "domain.tutorial.rank.archers.title", message: "Garrison archers" }),
      why: msg({ id: "domain.tutorial.rank.archers.why", message: "Tower posts need archers." })
    },
    "rank.coin-reserve": {
      why: msg({
        id: "domain.tutorial.rank.coinReserve.why", message: "A coin reserve funds veteran training."
      })
    },
    "rank.coins": {
      why: msg({
        id: "domain.tutorial.rank.coins.why",
        message: "Deliver coins to military buildings for training."
      })
    },
    "rank.gold": {
      tips: msg({
        id: "domain.tutorial.rank.gold.tips",
        message: "Build on a surveyed gold deposit and provide food."
      }),
      why: msg({ id: "domain.tutorial.rank.gold.why", message: "Gold ore supplies the Mint." })
    },
    "rank.gold-output": {
      why: msg({
        id: "domain.tutorial.rank.goldOutput.why", message: "Gold ore can become training coins."
      })
    },
    "rank.mint": {
      tips: msg({
        id: "domain.tutorial.rank.mint.tips", message: "Supply the Mint with gold ore and coal."
      }),
      why: msg({
        id: "domain.tutorial.rank.mint.why", message: "Coins train soldiers to higher ranks."
      })
    },
    "rank.soldiers": {
      title: msg({ id: "domain.tutorial.rank.soldiers.title", message: "Promote soldiers" }),
      why: msg({
        id: "domain.tutorial.rank.soldiers.why",
        message: "Higher ranks improve soldier health and combat strength."
      })
    },
    "rank.veterans": {
      title: msg({ id: "domain.tutorial.rank.veterans.title", message: "Train veterans" }),
      why: msg({
        id: "domain.tutorial.rank.veterans.why", message: "Veterans give your army a stronger core."
      })
    },
    "rank.veterans-prep": {
      tips: msg({
        id: "domain.tutorial.rank.veteransPrep.tips",
        message: "Train three soldiers to rank two. The Mint supplies coins and your nation's drink fuels training."
      }),
      title: msg({ id: "domain.tutorial.rank.veteransPrep.title", message: "Promote veterans" }),
      why: msg({
        id: "domain.tutorial.rank.veteransPrep.why",
        message: "Veterans form the core of your growing army."
      })
    },
    "rank.watchtower": {
      tips: msg({
        id: "domain.tutorial.rank.watchtower.tips",
        message: "Recruit archers (a bow, armour and beer each) and keep the tower connected."
      }),
      why: msg({
        id: "domain.tutorial.rank.watchtower.why",
        message: "A Watchtower gives archers protected firing posts."
      })
    },
    "sea.expedition": {
      title: msg({ id: "domain.tutorial.sea.expedition.title", message: "Start an expedition" }),
      why: msg({
        id: "domain.tutorial.sea.expedition.why",
        message: "Visit colonies for ore and adventures for battles and rewards."
      })
    },
    "sea.harbour": {
      tips: msg({
        id: "domain.tutorial.sea.harbour.tips",
        message: "Choose a coast with enough room for ships to approach."
      }),
      why: msg({
        id: "domain.tutorial.sea.harbour.why",
        message: "The Harbour stores goods and launches expeditions."
      })
    },
    "sea.ship": {
      title: msg({ id: "domain.tutorial.sea.ship.title", message: "Launch a ship" }),
      why: msg({
        id: "domain.tutorial.sea.ship.why", message: "Ships carry troops and supplies overseas."
      })
    },
    "sea.shipyard": {
      tips: msg({
        id: "domain.tutorial.sea.shipyard.tips",
        message: "Build by a clear shore, select Ship production and supply its planks. Small boats do not count."
      }),
      why: msg({
        id: "domain.tutorial.sea.shipyard.why",
        message: "A Shipyard launches ships for trade and expeditions."
      })
    },
    "sea.stock": {
      benefit: msg({ id: "domain.tutorial.sea.stock.benefit", message: "Supplies ready to sail." }),
      tips: msg({
        id: "domain.tutorial.sea.stock.tips",
        message: "Keep thirty planks in a completed home-island Harbour."
      }),
      title: msg({ id: "domain.tutorial.sea.stock.title", message: "Stock the Harbour" }),
      why: msg({
        id: "domain.tutorial.sea.stock.why", message: "Expeditions need construction supplies."
      })
    },
    "sea.trade-offer": {
      benefit: msg({
        id: "domain.tutorial.sea.tradeOffer.benefit",
        message: "A market for surplus wares and missing goods."
      }),
      tips: msg({
        id: "domain.tutorial.sea.tradeOffer.tips",
        message: "Open the Harbour's Market, choose what you give and what you want, then place the offer. It does not need to be accepted."
      }),
      title: msg({ id: "domain.tutorial.sea.tradeOffer.title", message: "Place a trade offer" }),
      why: msg({
        id: "domain.tutorial.sea.tradeOffer.why",
        message: "The Market swaps your surplus wares for the goods your island lacks."
      })
    },
    "settlers.medium-residence": {
      tips: msg({
        id: "domain.tutorial.settlers.mediumResidence.tips",
        message: "Place it on free ground and connect a road."
      }),
      why: msg({
        id: "domain.tutorial.settlers.mediumResidence.why",
        message: "A Medium residence raises the population limit and bears new settlers."
      })
    },
    "settlers.residence": {
      tips: msg({
        id: "domain.tutorial.settlers.residence.tips",
        message: "Place them on free ground and connect a road. Nobody works there, so they need only a builder."
      }),
      why: msg({
        id: "domain.tutorial.settlers.residence.why",
        message: "Every worker and soldier counts toward the island's population limit; a residence raises it and bears new settlers."
      })
    },
    "stone.delivery": {
      why: msg({
        id: "domain.tutorial.stone.delivery.why",
        message: "The village paves its square with your stone."
      })
    },
    "stone.output": {
      why: msg({
        id: "domain.tutorial.stone.output.why",
        message: "Keep stone available for larger construction projects."
      })
    },
    "stone.quarry": {
      tips: msg({
        id: "domain.tutorial.stone.quarry.tips",
        message: "Place within reach of surface rocks; the worker needs a pickaxe."
      }),
      why: msg({ id: "domain.tutorial.stone.quarry.why", message: "Larger buildings need stone." })
    },
    "talent.apply": {
      benefit: msg({
        id: "domain.tutorial.talent.apply.benefit",
        message: "A permanent bonus that follows you to every island."
      }),
      tips: msg({
        id: "domain.tutorial.talent.apply.tips",
        message: "Open Talents with the star button below your portrait, place a point and press Apply. A talent applied earlier also counts."
      }),
      title: msg({ id: "domain.tutorial.talent.apply.title", message: "Learn a talent" }),
      why: msg({
        id: "domain.tutorial.talent.apply.why",
        message: "Every player level gives one talent point for a permanent bonus."
      })
    },
    "wood.forester": {
      tips: msg({
        id: "domain.tutorial.wood.forester.tips",
        message: "Place beside your Woodcutter with free planting ground."
      }),
      why: msg({ id: "domain.tutorial.wood.forester.why", message: "Foresters replace harvested trees." })
    },
    "wood.logs": {
      why: msg({
        id: "domain.tutorial.wood.logs.why", message: "Timber feeds construction and your Sawmill."
      })
    },
    "wood.plant": {
      title: msg({ id: "domain.tutorial.wood.plant.title", message: "Plant a forest" }),
      why: msg({
        id: "domain.tutorial.wood.plant.why", message: "A renewed forest keeps the timber chain running."
      })
    },
    "wood.planks": {
      why: msg({ id: "domain.tutorial.wood.planks.why", message: "A reserve of planks lets you expand." })
    },
    "wood.planks-delivery": {
      why: msg({
        id: "domain.tutorial.wood.planksDelivery.why",
        message: "The village needs planks to repair its homes."
      })
    },
    "wood.sawmill": {
      tips: msg({
        id: "domain.tutorial.wood.sawmill.tips",
        message: "The Sawmill turns logs into planks. Connect both buildings to storage."
      }),
      why: msg({
        id: "domain.tutorial.wood.sawmill.why", message: "Planks are needed for almost every building."
      })
    },
    "wood.storage": {
      tips: msg({
        id: "domain.tutorial.wood.storage.tips",
        message: "Place it between distant workplaces and connect it to the road network."
      }),
      why: msg({
        id: "domain.tutorial.wood.storage.why", message: "Local storage shortens carrier journeys."
      })
    },
    "wood.woodcutter": {
      tips: msg({
        id: "domain.tutorial.wood.woodcutter.tips",
        message: "Place near trees and connect a road. The worker needs an axe."
      }),
      why: msg({
        id: "domain.tutorial.wood.woodcutter.why", message: "Logs are your first construction material."
      })
    }
  },
  templates: {
    buildMany: msg({ id: "domain.tutorial.template.buildMany", message: "Build {count} {building}" }),
    buildOne: msg({ id: "domain.tutorial.template.buildOne", message: "Build a {building}" }),
    deliver: msg({ id: "domain.tutorial.template.deliver", message: "Deliver {count} {ware} to the village" }),
    produce: msg({ id: "domain.tutorial.template.produce", message: "Produce {count} {ware}" })
  }
} as const;
