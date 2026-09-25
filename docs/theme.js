// The light/dark button in the header.
//
// By default the site follows the system theme, using CSS alone. The button
// switches to the other theme and keeps it, even if the system changes
// later. Switching back to the system's theme goes back to following it.
//
// The choice is saved in localStorage as "color-scheme", only after a click.
// The website privacy policy mentions this. A short script in each page's
// <head> applies it before the page is drawn. This file only runs the button.

(function () {
  const KEY = "color-scheme";
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]');
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const button = document.querySelector(".theme-toggle");
  if (!button) return;

  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (e) {
      return null;
    }
  }

  // null means "follow the system". Kept in a variable so the button still
  // works if storage is blocked.
  let choice = saved();

  function system() {
    return systemDark.matches ? "dark" : "light";
  }

  function showing() {
    return choice || system();
  }

  function apply() {
    root.classList.remove("light", "dark");
    if (choice) root.classList.add(choice);
    meta.content = choice || "light dark";

    const next = showing() === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", "Switch to " + next + " theme");
    button.dataset.showing = showing();
  }

  button.addEventListener("click", function () {
    const target = showing() === "dark" ? "light" : "dark";
    // Picking the system's own theme means "follow the system".
    choice = target === system() ? null : target;
    try {
      if (choice) localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch (e) {
      // Storage blocked. The switch still works, it just isn't remembered.
    }
    apply();
  });

  // The CSS follows system changes by itself. This keeps the icon right.
  systemDark.addEventListener("change", apply);

  apply();
  button.hidden = false;
})();
