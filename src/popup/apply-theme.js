// Sets the theme before the popup is drawn, so dark mode doesn't flash white.
//
// It's a plain script loaded in <head> without "defer", because that's the
// only way it runs before the page appears. It reads the localStorage copy of
// the setting, since chrome.storage.local is too slow here. src/lib/theme.js
// keeps that copy up to date.
//
// Don't delete this file: the popup would flash white every time it opens.
//
// The few lines that pick light or dark copy resolveTheme() in
// src/lib/theme.js, because a plain script can't import from a module. If you
// change one, change the other.
(function () {
  "use strict";

  var theme = "light";

  try {
    // "light" or "dark" if someone picked one. Anything else means follow
    // the system.
    var choice = window.localStorage.getItem("theme");
    var systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (choice === "dark" || (choice !== "light" && systemIsDark)) {
      theme = "dark";
    }
  } catch (error) {
    // Fall back to light. popup.js corrects it a moment later.
  }

  document.documentElement.dataset.theme = theme;
})();
