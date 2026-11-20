import { msg } from "@lingui/core/macro";

export const INVENTORY_MESSAGES = {
  battle: msg({ id: "inventory.tab.battle", message: "Battle" }),
  decoration: msg({ id: "inventory.tab.decoration", message: "Decoration" }),
  misc: msg({ id: "inventory.tab.misc", message: "Misc" }),
  categories: msg({ id: "inventory.categories", message: "Inventory categories" }),
  recoveryName:msg({ id:"inventory.commanderRecovery.name",message:"Commander recovery" }),
  recoveryDescription:msg({ id:"inventory.commanderRecovery.description",message:"Fully recover a defeated or recovering commander at their home lodge. Cannot heal a commander in combat." }),
  recoveryBlocked:msg({ id:"inventory.commanderRecovery.blocked",message:"A defeated or recovering commander and a completed home lodge are required." }),
  recoveryTarget:msg({ id:"inventory.commanderRecovery.target",message:"{name} · {hp}/{maximum} HP" }),
  recoveryWorking:msg({ id:"inventory.commanderRecovery.working",message:"Recovering the commander…" }),
  recoveryVerification:msg({ id:"inventory.commanderRecovery.verification",message:"Save verification is pending. Try again shortly. Your item is kept." }),
  recoveryFailed:msg({ id:"inventory.commanderRecovery.failed",message:"The recovery could not finish. Reopen the inventory and try again." }),
  confirm: msg({ id: "inventory.confirm", message: "Confirm" }),
  cancel: msg({ id: "inventory.cancel", message: "Cancel" }),
  slotLabel: msg({ id: "inventory.slotLabel", message: "{item}, quantity {count}" }),
  title: msg({ id: "inventory.title", message: "Inventory" }),
  items: msg({ id: "inventory.items", message: "Items" }),
  chooseNation: msg({ id: "inventory.chooseNation", message: "Choose nation" }),
  description: msg({ id: "inventory.chooseNation.description", message: "Change your nation once. You can hold one of these items." }),
  purchaseAdded: msg({ id: "inventory.purchaseAdded", message: "Item added to inventory." }),
  owned: msg({ id: "inventory.owned", message: "Owned: {count}" }),
  empty: msg({ id: "inventory.empty", message: "Your inventory is empty. Personal items are available in the gem shop." }),
  use: msg({ id: "inventory.use", message: "Use" }),
  locked: msg({ id: "inventory.nationLocked", message: "A Choose nation item from the gem shop is required to change your nation." }),
  loading: msg({ id: "inventory.loading", message: "Loading inventory…" }),
  failed: msg({ id: "inventory.failed", message: "The inventory could not load. Close and reopen to retry." })
} as const;
