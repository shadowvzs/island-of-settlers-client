import { msg } from "@lingui/core/macro";

/** Settings chrome, camera controls and HUD theme labels. */
export const SETTINGS_CHROME_MESSAGES = {
  camera: {
    bookmarks: msg({ id: "settings.camera.bookmarks", message: "Camera bookmarks" }),
    bookmarkName: msg({ id: "settings.camera.bookmarkName", message: "Bookmark name" }),
    cinematic: msg({ id: "settings.camera.cinematic", message: "Cinematic camera (C)" }),
    controls: msg({ id: "settings.camera.controls", message: "Camera controls" }),
    deleteBookmark: msg({ id: "settings.camera.deleteBookmark", message: "Delete bookmark {name}" }),
    goTo: msg({ id: "settings.camera.goTo", message: "Go to {name}" }),
    move: msg({ id: "settings.camera.move", message: "Move camera" }),
    moveDown: msg({ id: "settings.camera.moveDown", message: "Move down" }),
    moveLeft: msg({ id: "settings.camera.moveLeft", message: "Move left" }),
    moveRight: msg({ id: "settings.camera.moveRight", message: "Move right" }),
    moveUp: msg({ id: "settings.camera.moveUp", message: "Move up" }),
    namePlaceholder: msg({ id: "settings.camera.namePlaceholder", message: "Name this view" }),
    pitchDown: msg({ id: "settings.camera.pitchDown", message: "Pitch down" }),
    pitchUp: msg({ id: "settings.camera.pitchUp", message: "Pitch up" }),
    reset: msg({ id: "settings.camera.reset", message: "Reset camera" }),
    rotate: msg({ id: "settings.camera.rotate", message: "Rotate camera" }),
    rotateLeft: msg({ id: "settings.camera.rotateLeft", message: "Rotate left" }),
    rotateRight: msg({ id: "settings.camera.rotateRight", message: "Rotate right" }),
    saveThisView: msg({ id: "settings.camera.saveThisView", message: "Save this camera view" }),
    saveView: msg({ id: "settings.camera.saveView", message: "Save view" }),
    status: msg({
      id: "settings.camera.status",
      message: "{count}/{max} views on this island. Saved with your game."
    }),
    statusInvalid: msg({
      id: "settings.camera.statusInvalid",
      message: "Enter a view name (up to 40 characters)."
    }),
    view: msg({ id: "settings.camera.view", message: "Camera view" }),
    zoom: msg({ id: "settings.camera.zoom", message: "Zoom camera" }),
    zoomIn: msg({ id: "settings.camera.zoomIn", message: "Zoom in" }),
    zoomOut: msg({ id: "settings.camera.zoomOut", message: "Zoom out" })
  },
  window: {
    credits: msg({ id: "settings.window.credits", message: "Credits" }),
    customization: msg({ id: "settings.window.customization", message: "Customization" }),
    gameNews: msg({ id: "settings.window.gameNews", message: "Game News" }),
    language: msg({ id: "settings.window.language", message: "Language" }),
    musicPlayer: msg({ id: "settings.window.musicPlayer", message: "Music player" })
  },
  theme: {
    dark: msg({ id: "settings.theme.dark", message: "Dark" }),
    light: msg({ id: "settings.theme.light", message: "Light" }),
    mode: msg({ id: "settings.theme.mode", message: "Mode" }),
    style: msg({ id: "settings.theme.style", message: "Style" }),
    title: msg({ id: "settings.theme.title", message: "Theme and style" }),
    window: msg({ id: "settings.theme.window", message: "Theme" }),
    styleName: {
      bevel: msg({ id: "settings.theme.style.bevel", message: "Raised bevel" }),
      carved: msg({ id: "settings.theme.style.carved", message: "Carved and embossed" }),
      cleanWindow: msg({ id: "settings.theme.style.cleanWindow", message: "Clean window, paper buttons" }),
      current: msg({ id: "settings.theme.style.current", message: "Paper buttons (current)" }),
      paperWindow: msg({ id: "settings.theme.style.paperWindow", message: "Paper window, clean buttons" }),
      parchment: msg({ id: "settings.theme.style.parchment", message: "Ancient parchment window" }),
      plaque: msg({ id: "settings.theme.style.plaque", message: "Gold-framed plaque" }),
      vellum: msg({ id: "settings.theme.style.vellum", message: "Aged vellum window" })
    }
  }
} as const;
