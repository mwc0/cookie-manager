// Light / dark theme.
//
// Three choices: "auto" (the default) follows the operating system, while
// "light" and "dark" pin it regardless of what the OS is doing.
//
// The RESOLVED theme -- only ever "light" or "dark" -- is written to
// data-theme on <html>, and that attribute is the only thing the CSS looks at.
//
// Resolving "auto" here in JS rather than with a CSS media query is
// deliberate. The alternative needs the dark colours written twice: once
// inside @media (prefers-color-scheme: dark) for auto, and again under
// :root[data-theme="dark"] for the explicit choice. Two copies of the same
// colour list drift apart the first time one of them is edited. This way
// there is exactly one dark block in popup.css.

export const THEME_KEY = "theme";
export const THEMES = ["auto", "light", "dark"];
const DEFAULT_THEME = "auto";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// chrome.storage.local is the source of truth, matching the rest of the
// extension's settings. The choice is ALSO mirrored into localStorage, purely
// because popup/apply-theme.js has to read it synchronously before the first
// paint -- chrome.storage.local is async, so on its own it guarantees a white
// flash every time a dark-mode user opens the popup.
//
// localStorage is only ever a cache. It is per-profile, so it does not cross
// the split-incognito boundary; chrome.storage.local does, which is why the
// real value lives there.
const MIRROR_KEY = "theme";

function isValidTheme(value) {
  return THEMES.includes(value);
}

// Turn a choice into the theme actually being shown.
export function resolveTheme(choice) {
  if (choice === "light" || choice === "dark") {
    return choice;
  }

  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch (error) {
    // matchMedia is not something to fail the popup over.
    return "light";
  }
}

// Paint it. Safe to call as often as you like.
export function applyTheme(choice) {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

// Read the stored choice. Never throws: a storage failure just means the
// default, which is the same thing the user saw before they ever touched it.
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

// Save a choice and apply it. Returns { error }.
//
// The theme is applied and mirrored BEFORE the await, so the switch responds
// instantly and still looks right even if the write then fails. A theme that
// only changes once storage has confirmed it feels broken on a slow disk.
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

// Keep the synchronous mirror in step. Failing here costs a flash on the next
// open, nothing more, so it stays quiet.
export function mirror(choice) {
  try {
    window.localStorage.setItem(MIRROR_KEY, choice);
  } catch (error) {
    // Private mode, blocked site data, or a full quota. Not worth reporting.
  }
}

// Call onChange whenever the OS theme flips, so "auto" keeps up while the
// popup is open. Returns a function that stops listening.
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
