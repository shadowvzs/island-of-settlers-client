import { msg } from "@lingui/core/macro";

/** Maintenance tab copy (English source; GM-I18N adds the other languages). */
export const MAINTENANCE_MESSAGES = {
  sections: {
    accounts: msg({ id: "admin.maintenance.sections.accounts", message: "Account slots" }),
    audit: msg({ id: "admin.maintenance.sections.audit", message: "Audit log" }),
    browser: msg({ id: "admin.maintenance.sections.browser", message: "This browser" }),
    content: msg({ id: "admin.maintenance.sections.content", message: "Published content" }),
    server: msg({ id: "admin.maintenance.sections.server", message: "Server data" })
  },
  scope: {
    both: msg({ id: "admin.maintenance.scope.both", message: "Online and offline" }),
    browser: msg({ id: "admin.maintenance.scope.browser", message: "This browser" }),
    online: msg({ id: "admin.maintenance.scope.online", message: "Online" })
  },
  status: {
    flags: msg({
      id: "admin.maintenance.status.flags",
      message: "Server {host}: database reset {databaseReset}, account reset {destructiveActions}."
    }),
    flagOff: msg({ id: "admin.maintenance.status.flagOff", message: "off ({flag})" }),
    flagOn: msg({ id: "admin.maintenance.status.flagOn", message: "on" }),
    loadFailed: msg({ id: "admin.maintenance.status.loadFailed", message: "Not loaded: {error}" }),
    standalone: msg({
      id: "admin.maintenance.status.standalone", message: "No server: only this browser's tools are available."
    }),
    done: msg({ id: "admin.maintenance.status.done", message: "Done: {tool}." })
  },
  reasons: {
    flag: msg({ id: "admin.maintenance.reasons.flag", message: "Disabled on this server ({flag})" }),
    noCatchUp: msg({
      id: "admin.maintenance.reasons.noCatchUp", message: "This server runs without catch-up (no verifier threads)."
    }),
    noVersion: msg({ id: "admin.maintenance.reasons.noVersion", message: "The slot has no stored game build." }),
    placeholder: msg({ id: "admin.maintenance.reasons.placeholder", message: "Not available yet (placeholder)." })
  },
  tools: {
    M1: msg({ id: "admin.maintenance.tools.M1", message: "Reset game data" }),
    M1Info: msg({
      id: "admin.maintenance.tools.M1Info",
      message: "Saves, wallets, campaign progress, social and chat data go; accounts, settings and content stay."
    }),
    M2: msg({ id: "admin.maintenance.tools.M2", message: "Recreate database" }),
    M2Info: msg({
      id: "admin.maintenance.tools.M2Info",
      message: "Everything goes, every account included (yours too). Only this audit stays."
    }),
    M3: msg({ id: "admin.maintenance.tools.M3", message: "Restore game data from a backup" }),
    M3Info: msg({
      id: "admin.maintenance.tools.M3Info",
      message: "Runs on the host: db/tools/backup.mjs, then db/tools/restore-new.mjs into a NEW database ({doc})."
    }),
    M4: msg({ id: "admin.maintenance.tools.M4", message: "Reset the progress of {name}" }),
    M5: msg({ id: "admin.maintenance.tools.M5", message: "Run catch-up for slot {slot}" }),
    M6: msg({ id: "admin.maintenance.tools.M6", message: "Re-verify the chain of slot {slot}" }),
    M7: msg({ id: "admin.maintenance.tools.M7", message: "Clear my cloud saves" }),
    M7Info: msg({
      id: "admin.maintenance.tools.M7Info", message: "Your own cloud slots and session; your account and wallet stay."
    }),
    M8Publish: msg({ id: "admin.maintenance.tools.M8Publish", message: "Publish {name} (Ready)" }),
    M8Unpublish: msg({ id: "admin.maintenance.tools.M8Unpublish", message: "Unpublish {name} (Draft)" }),
    M8Bundle: msg({
      id: "admin.maintenance.tools.M8Bundle",
      message: "Offline builds get campaigns from the campaign bundle export (CAMP-BUNDLE), not from this list."
    }),
    M9: msg({ id: "admin.maintenance.tools.M9", message: "Roll the starter map back to revision {revision}" }),
    M10: msg({ id: "admin.maintenance.tools.M10", message: "Global winter appearance" }),
    M11: msg({ id: "admin.maintenance.tools.M11", message: "Clear this browser's caches" }),
    M11Info: msg({
      id: "admin.maintenance.tools.M11Info",
      message: "Island cache, packed worker results and downloaded starter maps; rebuilt on the next load."
    }),
    M12: msg({ id: "admin.maintenance.tools.M12", message: "Reset this browser's game data" }),
    M12Info: msg({
      id: "admin.maintenance.tools.M12Info", message: "Every browser slot goes; the game settings stay."
    }),
    M12b: msg({ id: "admin.maintenance.tools.M12b", message: "Recreate this browser's database" }),
    M12bInfo: msg({
      id: "admin.maintenance.tools.M12bInfo",
      message: "Deletes the whole local database, local accounts and settings included; the page reloads."
    })
  },
  confirm: {
    cancel: msg({ id: "admin.maintenance.confirm.cancel", message: "Cancel" }),
    closeTabs: msg({
      id: "admin.maintenance.confirm.closeTabs", message: "Close the game tabs of this browser first."
    }),
    input: msg({ id: "admin.maintenance.confirm.input", message: "Confirmation text" }),
    run: msg({ id: "admin.maintenance.confirm.run", message: "Run: {tool}" }),
    typeToConfirm: msg({ id: "admin.maintenance.confirm.typeToConfirm", message: "Type “{expected}” to confirm." }),
    wallet: msg({
      id: "admin.maintenance.confirm.wallet", message: "Also the wallet, inventory and customization"
    }),
    accountReset: msg({
      id: "admin.maintenance.confirm.accountReset",
      message: "Cloud slots, campaign progress and attempts go and the session ends. The account stays."
    }),
    playerVisible: msg({
      id: "admin.maintenance.confirm.playerVisible", message: "Players see this change at their next load."
    }),
    catchUp: msg({
      id: "admin.maintenance.confirm.catchUp",
      message: "The server advances the slot to now and stores a new revision."
    })
  },
  results: {
    accountReset: msg({
      id: "admin.maintenance.results.accountReset",
      message: "{slots} slots, {progress} campaign progress rows and {attempts} attempts removed."
    }),
    catchUpAdvanced: msg({ id: "admin.maintenance.results.catchUpAdvanced", message: "The slot advanced." }),
    catchUpUnchanged: msg({ id: "admin.maintenance.results.catchUpUnchanged", message: "Nothing to catch up." }),
    cleared: msg({ id: "admin.maintenance.results.cleared", message: "{count} cloud slots removed." })
  },
  accounts: {
    choose: msg({ id: "admin.maintenance.accounts.choose", message: "Account" }),
    none: msg({ id: "admin.maintenance.accounts.none", message: "No cloud slots." }),
    placeholder: msg({ id: "admin.maintenance.accounts.placeholder", message: "Choose an account" }),
    slot: msg({
      id: "admin.maintenance.accounts.slot",
      message: "{slotNo}. {name} · revision {revision} · verified {verified}"
    }),
    flagged: msg({ id: "admin.maintenance.accounts.flagged", message: "flagged" }),
    unverified: msg({ id: "admin.maintenance.accounts.unverified", message: "none" })
  },
  content: {
    campaigns: msg({ id: "admin.maintenance.content.campaigns", message: "Campaigns" }),
    current: msg({ id: "admin.maintenance.content.current", message: "current" }),
    noCampaigns: msg({ id: "admin.maintenance.content.noCampaigns", message: "No campaigns on the server." }),
    noStarter: msg({ id: "admin.maintenance.content.noStarter", message: "No starter map published." }),
    starter: msg({ id: "admin.maintenance.content.starter", message: "Starter map history" }),
    stateDraft: msg({ id: "admin.maintenance.content.stateDraft", message: "Draft" }),
    stateReady: msg({ id: "admin.maintenance.content.stateReady", message: "Ready" })
  },
  audit: {
    empty: msg({ id: "admin.maintenance.audit.empty", message: "No administrator actions yet." }),
    reload: msg({ id: "admin.maintenance.audit.reload", message: "Reload the audit log" }),
    when: msg({ id: "admin.maintenance.audit.when", message: "When" }),
    who: msg({ id: "admin.maintenance.audit.who", message: "Who" }),
    action: msg({ id: "admin.maintenance.audit.action", message: "Action" }),
    target: msg({ id: "admin.maintenance.audit.target", message: "Target" }),
    result: msg({ id: "admin.maintenance.audit.result", message: "Result" }),
    nobody: msg({ id: "admin.maintenance.audit.nobody", message: "not signed in" })
  }
} as const;
