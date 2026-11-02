// Small helpers every part of the popup uses: finding an element, switching
// screens, the status line under the header, and whether the popup is open
// in a tab of its own or in the side panel.

import { pluralise, describeError } from "../lib/format.js";

export const el = (id) => document.getElementById(id);

// Opened with "Open in a tab", the page is popup.html?tab=<id>, where <id> is
// the tab it was opened from. Otherwise it's the toolbar popup.
export const targetTabId = Number(new URLSearchParams(location.search).get("tab")) || null;
export const inTab = targetTabId !== null;
if (inTab) {
  document.body.classList.add("in-tab");
}

// Opened with "Open in side panel", the page is popup.html?panel=1, and it
// follows whichever tab is active in its window.
export const inPanel = new URLSearchParams(location.search).get("panel") === "1";
if (inPanel) {
  document.body.classList.add("in-panel");
}

export function showState(name) {
  for (const section of document.querySelectorAll(".state")) {
    section.hidden = section.id !== "state-" + name;
  }
}

export function showError(error) {
  const message = describeError(error);
  el("error-message").textContent = message;
  showState("error");
}

export function showBlocked(message) {
  el("blocked-message").textContent = message;
  showState("blocked");
}

// A short message above the delete panel, such as "Deleted session_id."
export function showMainMessage(text, isError) {
  const message = el("main-message");
  message.textContent = text;
  message.className = isError ? "result error" : "result";
  // It's a live region that stays on the page (see popup.html), but a few
  // screens still hide it as they open. See showState().
  message.hidden = false;
}

// " from example.com" for one site, " across 3 sites" for more.
export function describeSites(sites) {
  return sites.length === 1 ? " from " + sites[0] : " across " + pluralise(sites.length, "site", "sites");
}

// The screen showing now, such as "main" or "edit".
export function currentState() {
  const shown = document.querySelector(".state:not([hidden])");
  return shown ? shown.id.replace(/^state-/, "") : "";
}
