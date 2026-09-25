// The light/dark button in the header.
//
// The site follows the visitor's system setting by default, entirely in CSS.
// This button offers the opposite of whatever is showing. Picking it pins
// that exact theme (it stays dark even if the system later turns dark too);
// picking the system's own theme again goes back to following the system.
//
// The choice is kept in localStorage under "color-scheme", on the visitor's
// own device, and only once they click. The website privacy policy says so.
//
// The saved choice is applied before the page draws by a short inline script
// in each page's <head>, so there's no flash of the wrong theme. This file
// only runs the button.

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

  // null means "follow the system". Kept here rather than re-read from
  // storage, so the button still works where storage is blocked.
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
    // Choosing what the system already shows means "follow the system".
    choice = target === system() ? null : target;
    try {
      if (choice) localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch (e) {
      // Storage blocked: the switch still works, it just isn't remembered.
    }
    apply();
  });

  // The system setting can change while the page is open. The CSS follows it
  // by itself; this keeps the button's icon and label right.
  systemDark.addEventListener("change", apply);

  apply();
  button.hidden = false;
})();
