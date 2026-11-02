// The smaller screens and lines: the list of kept cookies, what the site has
// changed while cookieZ is open, the What's new line, and the review ask.

import { cookieKey } from "../lib/cookies.js";
import { listProtected, unprotectKeys } from "../lib/protect.js";
import { pluralise, formatCount, describeError, bareDomain } from "../lib/format.js";
import { noteJob, STORE_REVIEWS_URL } from "../lib/review.js";
import { state } from "./state.js";
import { el, showState } from "./ui.js";
import { drawTable, refreshScope } from "./popup.js";

// --- the list of kept cookies ----------------------------------------------

// "Kept cookies: 3" in the delete panel. It counts the whole saved list, not
// just this site's, so the list can be reached from any site.
export function showKeptLink() {
  const link = el("kept-open");
  link.hidden = state.protectedKeys.size === 0;
  link.textContent = "Kept cookies: " + formatCount(state.protectedKeys.size);
}

export async function openKept() {
  el("kept-message").textContent = "";
  cancelKeptConfirm();
  showState("kept");
  await drawKept();
  el("kept-back").focus();
}

// Draws the saved list. Built with textContent, like the main table, since
// cookie names come from websites.
async function drawKept() {
  const { entries, error } = await listProtected();
  if (error) {
    showKeptMessage(error, true);
  }

  const rows = el("kept-rows");
  rows.textContent = "";

  for (const entry of entries) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.className = "mono kept-name";
    name.textContent = entry.name;
    row.appendChild(name);

    const site = document.createElement("td");
    site.className = "mono kept-site";
    site.textContent = entry.domain;
    if (entry.partitionKey) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Partitioned";
      badge.title = "Kept separately for " + (entry.partitionKey.topLevelSite || "another site");
      site.appendChild(document.createTextNode(" "));
      site.appendChild(badge);
    }
    row.appendChild(site);

    const path = document.createElement("td");
    path.className = "mono kept-path";
    path.textContent = entry.path;
    row.appendChild(path);

    const action = document.createElement("td");
    action.className = "kept-action";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-button kept-stop";
    button.textContent = "Stop keeping";
    button.addEventListener("click", () => stopKeeping([entry], entry.name + " on " + entry.domain));
    action.appendChild(button);
    row.appendChild(action);

    rows.appendChild(row);
  }

  el("kept-table").hidden = entries.length === 0;
  el("kept-empty").hidden = entries.length > 0;
  el("kept-clear").hidden = entries.length === 0;
  return entries;
}

function showKeptMessage(text, isError) {
  const message = el("kept-message");
  message.textContent = text;
  message.className = isError ? "result error" : "result";
}

async function stopKeeping(entries, described) {
  const { keys, error } = await unprotectKeys(entries.map((entry) => entry.key));
  state.protectedKeys = keys;
  cancelKeptConfirm();
  await drawKept();
  if (error) {
    showKeptMessage(error, true);
  } else {
    showKeptMessage("No longer keeping " + described + ".", false);
  }
}

// "Stop keeping all" asks first, like the delete panel.
export async function startKeptConfirm() {
  const { entries } = await listProtected();
  el("kept-confirm-text").textContent =
    "Stop keeping " + (entries.length === 1 ? "this cookie" : "all " + formatCount(entries.length) + " cookies") + "?";
  el("kept-clear").hidden = true;
  el("kept-confirm").hidden = false;
  el("kept-confirm-no").focus();
}

export function cancelKeptConfirm() {
  el("kept-confirm").hidden = true;
  el("kept-clear").hidden = false;
}

export async function stopKeepingAll() {
  const { entries } = await listProtected();
  await stopKeeping(entries, pluralise(entries.length, "cookie", "cookies"));
}

// Back to the table, redrawn, since what's kept may have changed.
export async function closeKept() {
  el("kept-rows").textContent = "";
  showState("main");
  drawTable();
  await refreshScope();
  if (!el("kept-open").hidden) {
    el("kept-open").focus();
  }
}

// --- what changed ----------------------------------------------------------

// The most changes the list holds. See state.changeLog.
const CHANGE_LOG_LIMIT = 200;

// Chrome's reason for a change, in plain words. `removed` is false when a
// cookie was set, and true when one went away.
function describeCookieEvent(key, removed, cause) {
  if (!removed) {
    return state.overwritten.delete(key) ? "Changed" : "Added";
  }
  if (cause === "expired") {
    return "Expired";
  }
  if (cause === "expired_overwrite") {
    return "Removed, by setting a date in the past";
  }
  if (cause === "evicted") {
    return "Removed by Chrome to make room";
  }
  return "Removed";
}

// Adds one change to the list. Returns false for the first half of a
// change (see `overwritten`), which isn't listed by itself.
export function logChange(cookie, removed, cause) {
  const key = cookieKey(cookie);
  if (removed && cause === "overwrite") {
    state.overwritten.add(key);
    return false;
  }

  state.changeLog.unshift({
    at: Date.now(),
    name: cookie.name,
    domain: bareDomain(cookie.domain),
    what: describeCookieEvent(key, removed, cause),
  });
  state.changeLog.length = Math.min(state.changeLog.length, CHANGE_LOG_LIMIT);
  return true;
}

// "3 changes" next to the cookie count, once there's something to list.
export function showChangesLink() {
  el("changes-link").hidden = state.changeLog.length === 0;
  el("changes-open").textContent = pluralise(state.changeLog.length, "change", "changes");
}

export function drawChanges() {
  const rows = el("changes-rows");
  rows.textContent = "";

  for (const change of state.changeLog) {
    const row = document.createElement("tr");
    const cells = [
      [new Date(change.at).toLocaleTimeString(), "nowrap changes-time"],
      [change.name, "mono changes-name"],
      [change.domain, "mono changes-site"],
      [change.what, "changes-what"],
    ];
    for (const [text, className] of cells) {
      const cell = document.createElement("td");
      cell.className = className;
      cell.textContent = text;
      row.appendChild(cell);
    }
    rows.appendChild(row);
  }
}

export function openChanges() {
  drawChanges();
  showState("changes");
  el("changes-back").focus();
}

export function closeChanges() {
  el("changes-rows").textContent = "";
  showState("main");
  el("changes-open").focus();
}

// --- what's new ---------------------------------------------------------------

// One line, shown the first time cookieZ opens on a new version. Only the
// version number last seen is saved. On a fresh install, when no version
// has been saved yet, a welcome line shows instead.
const WHATS_NEW = {
  "2.2.0":
    "New: a tidier main screen with room for more cookies, and a Site report " +
    "beside the cookie count.",
  "2.1.0":
    "New: keep cookieZ open beside the page in Chrome's side panel, and Clear and reload " +
    "for a site you can't log in to.",
  "2.0.0":
    "New: search one field, such as name:session, and compare a site's cookies " +
    "with an earlier export, from Import.",
  "1.9.0":
    "New: block known trackers' cookies from Block, lock an export with a password, " +
    "and reload the site after a change.",
  "1.8.0":
    "New: block known trackers' cookies on every site, from Block. Cookies with a well-known name " +
    "now say who they're from.",
  "1.7.0":
    "New: the Block button at the top. You can now block other companies' cookies on every site, " +
    "and clear a site's stored data as well as its cookies.",
};

const WELCOME =
  "Welcome. Click a cookie to edit it. Can't log in to a site? Clear and reload usually " +
  "fixes it. Help (?) explains the rest.";
const PIN_HINT = " To keep cookieZ in reach, pin it from the puzzle piece in Chrome's toolbar.";

// Whether the What's new or welcome line showed on this open. The review
// line waits for another open rather than appear alongside it.
let whatsNewShown = false;

export async function showWhatsNew() {
  const version = chrome.runtime.getManifest().version;
  let text;
  try {
    const stored = await chrome.storage.local.get("seenVersion");
    if (stored.seenVersion === version) {
      return;
    }
    text = stored.seenVersion === undefined ? WELCOME : WHATS_NEW[version];
    if (stored.seenVersion === undefined) {
      const { isOnToolbar } = await chrome.action.getUserSettings();
      text += isOnToolbar ? "" : PIN_HINT;
    }
    await chrome.storage.local.set({ seenVersion: version });
  } catch (error) {
    return; // Not worth troubling anyone about.
  }
  if (text) {
    el("whats-new-text").textContent = text;
    el("whats-new").hidden = false;
    whatsNewShown = true;
  }
}

// --- asking for a review ----------------------------------------------------

// After a few deletes, imports or Saves have gone well, one quiet line asks
// for a review. See src/lib/review.js for when, and how rarely.
export async function countJob(message) {
  // A job that ended with an error doesn't count, and nor does one on an
  // open that already showed What's new, so the ask never lands then.
  if (whatsNewShown || message.classList.contains("error")) {
    return;
  }
  const ask = await noteJob();
  if (!ask) {
    return;
  }
  el("review-later").textContent = ask === "first" ? "Not now" : "No thanks";
  el("review-later").dataset.answer = ask === "first" ? "later" : "done";
  el("review-ask").hidden = false;
}

// Opens the store's review page in a new tab, only when clicked. Returns
// false, after saying why in `message`, if Chrome wouldn't open it.
export async function openReviewPage(message) {
  try {
    await chrome.tabs.create({ url: STORE_REVIEWS_URL });
    return true;
  } catch (error) {
    message.className = "result error";
    message.textContent = "Couldn't open the review page: " + describeError(error);
    message.hidden = false;
    return false;
  }
}
