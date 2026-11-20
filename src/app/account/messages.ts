import { msg } from "@lingui/core/macro";

/** Stable account chrome: the start scroll, Settings > Account and client-side field validation. */
export const ACCOUNT_MESSAGES = {
  form: {
    displayNameHint: msg({
      id: "account.form.displayNameHint",
      message: "Shown to other players: letters and numbers, {min}-{max}."
    }),
    passwordHint: msg({
      id: "account.form.passwordHint",
      message: "At least {min} characters."
    })
  },
  race: {
    chinese: msg({ id: "account.race.chinese", message: "Chinese" }),
    persian: msg({ id: "account.race.persian", message: "Persian" }),
    maya: msg({ id: "account.race.maya", message: "Classic Maya" }),
    indigenous: msg({ id: "account.race.indigenous", message: "Indigenous" }),
    japanese: msg({ id: "account.race.japanese", message: "Japanese" }),
    nubian: msg({ id: "account.race.nubian", message: "Nubian" }),
    roman: msg({ id: "account.race.roman", message: "Roman" }),
    viking: msg({ id: "domain.nation.viking", message: "Viking" })
  },
  scroll: {
    alreadyRegistered: msg({
      id: "account.scroll.alreadyRegistered",
      message: "Already registered?"
    }),
    choiceFailed: msg({
      id: "account.scroll.choiceFailed",
      message: "The online service did not answer. Please try again."
    }),
    displayName: msg({ id: "account.scroll.displayName", message: "Display name" }),
    email: msg({ id: "account.scroll.email", message: "Email" }),
    exportFailed: msg({
      id: "account.scroll.exportFailed",
      message: "The saves could not be exported. Please try again."
    }),
    exportSaves: msg({ id: "account.scroll.exportSaves", message: "Export their saves" }),
    guestHint: msg({
      id: "account.scroll.guestHint",
      message: "Guests play in this browser only: no online features, and nothing is uploaded."
    }),
    justLooking: msg({ id: "account.scroll.justLooking", message: "Just looking around?" }),
    loadFailed: msg({
      id: "account.scroll.loadFailed",
      message: "The account scroll could not load. Reload the page to try again."
    }),
    localAccountsMany: msg({
      id: "account.scroll.localAccountsMany",
      message: "Accounts now live online, so the browser accounts {names} are no longer used. Their saves are removed on {removeOn}: export them to keep a copy."
    }),
    localAccountsOne: msg({
      id: "account.scroll.localAccountsOne",
      message: "Accounts now live online, so the browser account {names} is no longer used. Its save is removed on {removeOn}: export it to keep a copy."
    }),
    localAccountsNote: msg({
      id: "account.scroll.localAccountsNote",
      message: "Import game (Menu) loads an exported file as a guest. This is offered once."
    }),
    localAccountsTitle: msg({
      id: "account.scroll.localAccountsTitle",
      message: "Saves of old local accounts"
    }),
    newPlayer: msg({ id: "account.scroll.newPlayer", message: "New player?" }),
    notNow: msg({ id: "account.scroll.notNow", message: "Not now" }),
    password: msg({ id: "account.scroll.password", message: "Password" }),
    playAsGuest: msg({ id: "cloud.actions.playAsGuest", message: "Play as guest" }),
    register: msg({ id: "account.scroll.register", message: "Register" }),
    registerLead: msg({
      id: "account.scroll.registerLead",
      message: "Sign the settlers' charter and choose your people to begin the voyage."
    }),
    saveServiceUnavailable: msg({
      id: "account.scroll.saveServiceUnavailable",
      message: "The save service did not answer."
    }),
    serviceUnavailable: msg({
      id: "account.scroll.serviceUnavailable",
      message: "The account service did not answer. Please try again."
    }),
    signIn: msg({ id: "account.scroll.signIn", message: "Sign in" }),
    signInLead: msg({
      id: "account.scroll.signInLead",
      message: "Welcome back, settler. Sign in to continue your voyage."
    }),
    title: msg({ id: "account.scroll.title", message: "Island of Settlers" }),
    choosePeople: msg({ id: "account.scroll.choosePeople", message: "Choose your people" })
  },
  settings: {
    cancel: msg({ id: "account.settings.cancel", message: "Cancel" }),
    leaveFailed: msg({
      id: "account.settings.leaveFailed",
      message: "The game could not be saved, so you are still playing here. Please try again."
    }),
    logOut: msg({ id: "account.settings.logOut", message: "Log out" }),
    logOutQuestion: msg({ id: "account.settings.logOutQuestion", message: "Save the game and log out?" }),
    onlineHint: msg({
      id: "account.settings.onlineHint",
      message: "Your islands are saved online in your account's save slot."
    }),
    saveAndChoose: msg({
      id: "account.settings.saveAndChoose",
      message: "Save and choose a slot"
    }),
    saveAndLogOut: msg({ id: "account.settings.saveAndLogOut", message: "Save and log out" }),
    saveFailed: msg({ id: "account.settings.saveFailed", message: "The game could not be saved." }),
    saving: msg({ id: "account.settings.saving", message: "Saving…" }),
    signedIn: msg({ id: "account.settings.signedIn", message: "Signed in as {displayName}." }),
    switchQuestion: msg({
      id: "account.settings.switchQuestion",
      message: "Save the game and choose another save slot?"
    }),
    switchSlot: msg({ id: "account.settings.switchSlot", message: "Switch save slot" })
  },
  validation: {
    accountTaken: msg({
      id: "account.validation.accountTaken",
      message: "This email or display name already has an account. Sign in instead."
    }),
    choosePeople: msg({ id: "account.validation.choosePeople", message: "Choose your people." }),
    displayNameCharset: msg({
      id: "account.validation.displayNameCharset",
      message: "Use English letters and numbers only (A-Z, 0-9): no spaces or symbols."
    }),
    displayNameLength: msg({
      id: "account.validation.displayNameLength",
      message: "The display name must be {min}-{max} characters long."
    }),
    displayNameRequired: msg({
      id: "account.validation.displayNameRequired",
      message: "Enter a display name."
    }),
    emailInvalid: msg({
      id: "account.validation.emailInvalid",
      message: "Enter a valid email address."
    }),
    emailRequired: msg({
      id: "account.validation.emailRequired",
      message: "Enter your email address."
    }),
    passwordLength: msg({
      id: "account.validation.passwordLength",
      message: "The password must be {min}-{max} characters long."
    }),
    passwordRequired: msg({
      id: "account.validation.passwordRequired",
      message: "Enter a password."
    }),
    serviceRefused: msg({
      id: "account.validation.serviceRefused",
      message: "The account service refused these details."
    }),
    signInPasswordRequired: msg({
      id: "account.validation.signInPasswordRequired",
      message: "Enter your password."
    }),
    tooManyAttempts: msg({
      id: "account.validation.tooManyAttempts",
      message: "Too many attempts. Wait a few minutes, then try again."
    }),
    wrongCredentials: msg({
      id: "account.validation.wrongCredentials",
      message: "Wrong email or password. Passwords are case-sensitive."
    })
  }
} as const;
