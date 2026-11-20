/**
 * UI smoke suite (TEST-01, `npm run test:ui`): one game page per project, every surface file below
 * adds its cases to it. A migrated surface adds `surfaces/<surface>.ts` and one import line here.
 * Owns real browser behaviour only (entry point, focus, Escape, drag, reopen policy, fit, page
 * errors); values and markup stay in the vitest markup tests.
 */
import "./surfaces/account-scroll";
import "./surfaces/army-orders";
import "./surfaces/army-rail";
import "./surfaces/building-details";
import "./surfaces/camera-panel";
import "./surfaces/corner-row";
import "./surfaces/customization-avatar";
import "./surfaces/development-tools";
import "./surfaces/expeditions";
import "./surfaces/lazy-windows";
import "./surfaces/map-editor";
import "./surfaces/map-generator";
import "./surfaces/military-supplies";
import "./surfaces/minimap";
import "./surfaces/music-player";
import "./surfaces/observe";
import "./surfaces/quests";
import "./surfaces/save-slots";
import "./surfaces/settings-languages";
import "./surfaces/settings-panel";
import "./surfaces/settlement-hud";
import "./surfaces/talents";
import "./surfaces/theme-popover";
import "./surfaces/title-page";
import "./surfaces/trade-office";
import "./surfaces/troop-ships";
