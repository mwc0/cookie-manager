// Light and dark theme. "auto" follows the system; "light" and "dark" stay
// fixed. The theme actually shown ("light" or "dark") goes on <html> as
// data-theme, and that's all the CSS looks at.
//
// "auto" is worked out here rather than in CSS so popup.css only needs the
// dark colours once. Doing it in CSS would mean two copies of the dark
// colours, and two copies drift apart.

export const THEME_KEY = "theme";
export const THEMES = ["auto", "light", "dark"];
const DEFAULT_THEME = "auto";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// The choice is saved in chrome.storage.local. A copy also goes in
// localStorage, because popup/apply-theme.js has to read it instantly, before
// the popup is drawn. chrome.storage.local is too slow for that and would
// cause a white flash. The copy is only a cache: incognito has its own
// localStorage, but shares chrome.storage.local.
const MIRROR_KEY = "theme";

function isValidTheme(value) {
  return THEMES.includes(value);
}

// Turns "auto" into "light" or "dark".
export function resolveTheme(choice) {
  if (choice === "light" || choice === "dark") {
    return choice;
  }

  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

export function applyTheme(choice) {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

// Never throws. If storage fails, the default ("auto") is used.
export async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_KEY);
    const value = stored ? stored[THEME_KEY] : null;
    return {
      choice: isValidTheme(value) ? value : DEFAULT_THEME,
      error: null,
    };
  } catch (error) {
    return {
      choice: DEFAULT_THEME,
      error:
        "Couldn't read your saved theme, so the system theme is being used: " +
        (error && error.message ? error.message : String(error)),
    };
  }
}

// Saves and applies a choice. Returns { error }. The theme changes before
// the save finishes, so the switch feels instant even if saving is slow.
export async function saveTheme(choice) {
  const value = isValidTheme(choice) ? choice : DEFAULT_THEME;

  applyTheme(value);
  mirror(value);

  try {
    await chrome.storage.local.set({ [THEME_KEY]: value });
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
    window.localStorage.setItem(MIRROR_KEY, choice);
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
