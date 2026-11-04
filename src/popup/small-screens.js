// The smaller screens and lines: the list of kept cookies, what the site has
// changed while cookieZ is open, the What's new line, and the review ask.

import { cookieKey } from "../lib/cookies.js";
import { listProtected, unprotectKeys } from "../lib/protect.js";
import { formatCount, describeError, bareDomain } from "../lib/format.js";
import { t, tn } from "../lib/i18n.js";
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
  link.textContent = t("main_keptLink", formatCount(state.protectedKeys.size));
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
      badge.title = entry.partitionKey.topLevelSite
        ? t("main_keptPartitionedFor", entry.partitionKey.topLevelSite)
        : t("main_keptPartitionedForOther");
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
    button.textContent = t("main_keptStopButton");
    button.addEventListener("click", () => stopKeeping([entry], t("main_keptStoppedOne", entry.name, entry.domain)));
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

// `done` is what to say once it has worked, such as "No longer keeping sid
// on example.com."
async function stopKeeping(entries, done) {
  const { keys, error } = await unprotectKeys(entries.map((entry) => entry.key));
  state.protectedKeys = keys;
  cancelKeptConfirm();
  await drawKept();
  if (error) {
    showKeptMessage(error, true);
  } else {
    showKeptMessage(done, false);
  }
}

// "Stop keeping all" asks first, like the delete panel.
export async function startKeptConfirm() {
  const { entries } = await listProtected();
  el("kept-confirm-text").textContent =
    entries.length === 1 ? t("main_keptConfirmOne") : t("main_keptConfirmAll", formatCount(entries.length));
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
  await stopKeeping(entries, tn("main_keptStoppedAll", entries.length));
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
    return state.overwritten.delete(key) ? t("main_eventChanged") : t("main_eventAdded");
  }
  if (cause === "expired") {
    return t("main_eventExpired");
  }
  if (cause === "expired_overwrite") {
    return t("main_eventExpiredOverwrite");
  }
  if (cause === "evicted") {
    return t("main_eventEvicted");
  }
  return t("main_eventRemoved");
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
  el("changes-open").textContent = tn("main_changesLink", state.changeLog.length);
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
// has been saved yet, a welcome line shows instead. The lines are in
// messages.json, one per version.
const WHATS_NEW = {
  "2.3.0": "main_whatsNew2_3_0",
  "2.2.1": "main_whatsNew2_2_1",
  "2.2.0": "main_whatsNew2_2_0",
  "2.1.0": "main_whatsNew2_1_0",
  "2.0.0": "main_whatsNew2_0_0",
  "1.9.0": "main_whatsNew1_9_0",
  "1.8.0": "main_whatsNew1_8_0",
  "1.7.0": "main_whatsNew1_7_0",
};

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
    if (stored.seenVersion === undefined) {
      // The welcome adds how to pin cookieZ when it isn't on the toolbar.
      const { isOnToolbar } = await chrome.action.getUserSettings();
      text = t(isOnToolbar ? "main_welcome" : "main_welcomePin");
    } else if (WHATS_NEW[version]) {
      text = t(WHATS_NEW[version]);
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
  el("review-later").textContent = ask === "first" ? t("main_reviewNotNow") : t("main_reviewNoThanks");
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
    message.textContent = t("main_reviewOpenFailed", describeError(error));
    message.hidden = false;
    return false;
  }
}
