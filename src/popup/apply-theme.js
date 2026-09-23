// Sets the theme before anything is painted.
//
// This is a plain script, not a module, and it is loaded from <head> WITHOUT
// defer on purpose: that combination is the only one the browser runs
// synchronously, before the body renders. A module would be deferred until
// after the first paint, which is exactly the flash this exists to prevent.
//
// It reads localStorage rather than chrome.storage.local because
// chrome.storage.local is async and therefore always too late. src/lib/theme.js
// owns the real value and keeps this mirror in step.
//
// If you delete this file, dark mode still works but the popup flashes white
// on every open. popup.css has one dark block, keyed off the data-theme
// attribute that this sets -- there is no media-query fallback to catch it.
//
// The resolve logic below is a deliberate three-line copy of resolveTheme() in
// src/lib/theme.js. A classic script cannot import from a module, so the
// choice is duplicating this much or accepting the flash. Change both together.
(function () {
  "use strict";

  var theme = "light";

  try {
    var choice = window.localStorage.getItem("theme") || "auto";
    var systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (choice === "dark" || (choice === "auto" && systemIsDark)) {
      theme = "dark";
    }
  } catch (error) {
    // Blocked site data or no matchMedia. Light is the safe default; the
    // module-side code corrects it a moment later once storage is readable.
  }

  document.documentElement.dataset.theme = theme;
})();
