// Light and dark theme. By default the popup follows the system theme. If
// someone picks the other one, that choice is saved and kept, even if the
// system changes later. Picking the system's own theme again removes the
// saved choice, so it goes back to following the system.
//
// The theme actually shown ("light" or "dark") goes on <html> as data-theme,
// and that's all the CSS looks at. Following the system is worked out here
// rather than in CSS, so popup.css only needs the dark colours once.

export const THEME_KEY = "theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// The choice is saved in chrome.storage.local. A copy also goes in
// localStorage, because popup/apply-theme.js has to read it instantly, before
// the popup is drawn. chrome.storage.local is too slow for that and would
// cause a white flash. The copy is only a cache: incognito has its own
// localStorage, but shares chrome.storage.local.
const MIRROR_KEY = "theme";

// "light" or "dark", or null for "follow the system". Anything else,
// including "auto" saved by version 1.0.0, means follow the system.
function asChoice(value) {
  return value === "light" || value === "dark" ? value : null;
}

export function systemTheme() {
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

// The theme to show for a saved choice.
export function resolveTheme(choice) {
  return asChoice(choice) || systemTheme();
}

// What to save when someone picks `theme`: nothing if it's the system's own
// theme, so the popup keeps following the system.
export function choiceFor(theme) {
  return theme === systemTheme() ? null : asChoice(theme);
}

export function applyTheme(choice) {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

// Never throws. If storage fails, the popup follows the system.
export async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_KEY);
    const value = stored ? stored[THEME_KEY] : undefined;
    const choice = asChoice(value);

    // Removes anything else, like the "auto" 1.0.0 saved, so only "light" or
    // "dark" is ever kept, as the privacy policy says.
    // If that fails it's tried again next time, so the error is ignored.
    if (value !== undefined && !choice) {
      try {
        await chrome.storage.local.remove(THEME_KEY);
      } catch (error) {
      }
    }
    return { choice, error: null };
  } catch (error) {
    return {
      choice: null,
      error:
        "Couldn't read your saved theme, so the system theme is being used: " +
        (error && error.message ? error.message : String(error)),
    };
  }
}

// Saves and applies the theme someone picked. Returns { error }. The theme
// changes before the save finishes, so the switch feels instant even if
// saving is slow.
export async function saveTheme(theme) {
  const choice = choiceFor(theme);

  applyTheme(choice);
  mirror(choice);

  try {
    if (choice) {
      await chrome.storage.local.set({ [THEME_KEY]: choice });
    } else {
      await chrome.storage.local.remove(THEME_KEY);
    }
    return { error: null };
  } catch (error) {
    return {
      error:
        "The theme changed, but couldn't be saved, so it will reset when you " +
        "reopen the popup: " + (error && error.message ? error.message : String(error)),
    };
  }
}

// Updates the localStorage copy. If that fails, the worst case is one white
// flash next time, so errors are ignored.
export function mirror(choice) {
  try {
    if (asChoice(choice)) {
      window.localStorage.setItem(MIRROR_KEY, choice);
    } else {
      window.localStorage.removeItem(MIRROR_KEY);
    }
  } catch (error) {
  }
}

// Calls onChange when the system theme changes while the popup is open.
// Returns a function that stops listening.
export function watchSystemTheme(onChange) {
  try {
    const query = window.matchMedia(DARK_QUERY);
    const handler = () => onChange();
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  } catch (error) {
    return () => {};
  }
}
