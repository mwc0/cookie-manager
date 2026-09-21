// Popup wiring: decides which screen to show, loads cookies, and runs the
// delete-with-scope flow.

import { hasHostAccess, requestHostAccess } from "../lib/permissions.js";
import {
  getCookiesForPage,
  getCookiesForScope,
  summarise,
  removeCookie,
  removeCookies,
  writeCookie,
  validateCookieValues,
  filterCookies,
  baseHostOf,
} from "../lib/cookies.js";
import {
  loadProtected,
  setProtected,
  isProtected,
  partitionByProtection,
  pruneProtected,
} from "../lib/protect.js";
import {
  pluralise,
  formatCount,
  formatExpiryFull,
  toLocalDateTimeValue,
  fromLocalDateTimeValue,
} from "../lib/format.js";
import { renderCookieTable } from "./render.js";

// The site in the current tab: { origin, hostname }.
let page = null;

// The exact cookies the selected scope would delete. The delete runs against
// this array, which is the same one the on-screen count was taken from, so
// the number shown and the number removed can't disagree.
let scopeCookies = [];

// The cookie currently open in the editor, or null when creating a new one.
// Held because saving needs the ORIGINAL identity to remove, not the edited
// one — see writeCookie().
let editing = null;

// Every cookie for this page, and the subset the search box is showing.
// `shownCookies` is what the "just the cookies shown" scope deletes, so it has
// to be the same array the table was built from.
let pageCookies = [];
let shownCookies = [];

// Keys of the cookies the user has asked us to keep. See src/lib/protect.js.
let protectedKeys = new Set();

const el = (id) => document.getElementById(id);

function showState(name) {
  for (const section of document.querySelectorAll(".state")) {
    section.hidden = section.id !== "state-" + name;
  }
}

function showError(error) {
  const message = error && error.message ? error.message : String(error);
  el("error-message").textContent = message;
  showState("error");
}

function showBlocked(message) {
  el("blocked-message").textContent = message;
  showState("blocked");
}

// --- startup ---------------------------------------------------------------

async function init() {
  showState("loading");
  try {
    if (await hasHostAccess()) {
      await loadCurrentPage();
    } else {
      showState("gate");
    }
  } catch (error) {
    showError(error);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadCurrentPage() {
  const tab = await getActiveTab();

  if (!tab || !tab.url) {
    showBlocked("Chrome didn't report an address for this tab.");
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch (error) {
    showBlocked("This tab's address couldn't be read: " + tab.url);
    return;
  }

  // chrome://, about:, file:, extension pages and the Web Store either have no
  // cookies or are off-limits to extensions. Say which, rather than showing an
  // empty table that looks like a failure.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    showBlocked(
      "Pages served over " + url.protocol + " don't have cookies an extension can read."
    );
    return;
  }

  page = { origin: url.origin, hostname: url.hostname };

  el("main-message").hidden = true;
  el("site-name").textContent = url.hostname;
  el("scope-target-page").textContent = url.hostname;
  el("scope-target-domain").textContent = baseHostOf(url.hostname);

  showState("main");
  await refresh();
}

// Re-read everything: the table for this site, and the count for the
// currently selected delete scope.
//
// Deliberately sequential. These used to run together, which was faster and
// wrong: refreshScope() reads the kept-cookie list and the filtered array
// that refreshTable() produces, so in parallel it could count a scope using
// an empty kept list -- and then delete a cookie the table was, at that same
// moment, drawing as kept.
async function refresh() {
  await refreshTable();
  await refreshScope();
}

async function refreshTable() {
  try {
    pageCookies = await getCookiesForPage(page);

    const { keys, error } = await loadProtected();
    protectedKeys = keys;
    if (error) {
      // A cookie the user believes is kept would be deleted anyway, so this
      // has to be visible rather than logged.
      showMainMessage(error, true);
    }

    // Forget keep-flags for cookies that no longer exist on this page, so a
    // site setting a new cookie with an old name doesn't inherit protection
    // the user never gave it.
    const domains = new Set(pageCookies.map((c) => String(c.domain || "").replace(/^\./, "")));
    domains.add(page.hostname);
    const pruned = await pruneProtected(protectedKeys, pageCookies, domains);
    protectedKeys = pruned.keys;

    drawTable();
  } catch (error) {
    showError(error);
  }
}

// Apply the search box to the loaded cookies and draw. Kept separate from
// refreshTable so typing filters what's already loaded instead of re-querying
// Chrome on every keystroke.
function drawTable() {
  const query = el("search-input").value;
  shownCookies = filterCookies(pageCookies, query);

  renderCookieTable(el("cookie-rows"), shownCookies, {
    onEdit: openEditor,
    onDelete: deleteOne,
    onProtect: toggleProtected,
    isProtected: (cookie) => isProtected(protectedKeys, cookie),
  });

  const filtering = query.trim() !== "";
  el("search-clear").hidden = !filtering;

  el("cookie-count").textContent = filtering
    ? pluralise(shownCookies.length, "cookie", "cookies") +
      " of " + pluralise(pageCookies.length, "cookie", "cookies")
    : pluralise(pageCookies.length, "cookie", "cookies");

  // The "just the cookies shown" scope only makes sense while filtering.
  el("scope-matches-row").hidden = !filtering;
  el("scope-target-matches").textContent = filtering
    ? pluralise(shownCookies.length, "match", "matches")
    : "";

  if (!filtering && selectedScope() === "matches") {
    document.querySelector('input[name="scope"][value="page"]').checked = true;
  }

  const nothingAtAll = pageCookies.length === 0;
  const nothingMatched = !nothingAtAll && shownCookies.length === 0;

  el("empty-message").textContent = nothingMatched
    ? "No cookies here match “" + query.trim() + "”."
    : "No cookies are set for this site.";
  el("empty-message").hidden = !(nothingAtAll || nothingMatched);
  el("cookie-table").hidden = nothingAtAll || nothingMatched;
}

// --- delete scope ----------------------------------------------------------

function selectedScope() {
  const checked = document.querySelector('input[name="scope"]:checked');
  return checked ? checked.value : "page";
}

async function refreshScope() {
  const summaryLine = el("scope-summary");
  const details = el("scope-domains");

  summaryLine.textContent = "Counting…";
  details.hidden = true;
  el("delete-button").disabled = true;
  cancelConfirm();

  let inScope;
  try {
    // "matches" is the search box's scope, and deletes exactly the rows on
    // screen — the same array the table was drawn from, not a re-query that
    // could disagree with it.
    inScope =
      selectedScope() === "matches"
        ? shownCookies
        : await getCookiesForScope(selectedScope(), page);
  } catch (error) {
    scopeCookies = [];
    summaryLine.textContent = "Couldn't count the cookies in this scope: " + error.message;
    return;
  }

  // Kept cookies are removed from the scope BEFORE the count is taken, so the
  // number on screen is still exactly the number that will be deleted.
  const { deletable, kept } = partitionByProtection(protectedKeys, inScope);
  scopeCookies = deletable;

  const { count, domains } = summarise(scopeCookies);
  const keptNote =
    kept.length > 0
      ? " " + pluralise(kept.length, "kept cookie", "kept cookies") + " will be left alone."
      : "";

  if (count === 0) {
    summaryLine.textContent =
      kept.length > 0
        ? "Nothing to delete in this scope —" + keptNote
        : "Nothing to delete in this scope.";
    el("delete-button").disabled = true;
    return;
  }

  summaryLine.textContent =
    "Will delete " +
    pluralise(count, "cookie", "cookies") +
    (domains.length === 1
      ? " from " + domains[0]
      : " across " + pluralise(domains.length, "domain", "domains")) +
    "." +
    keptNote;

  // Listing the exact domains is the point of the scope indicator: the user
  // sees what is about to go before agreeing to it.
  if (domains.length > 1) {
    const list = el("scope-domains-list");
    list.textContent = "";
    for (const domain of domains) {
      const item = document.createElement("li");
      item.textContent = domain; // untrusted input -- never innerHTML
      list.appendChild(item);
    }
    el("scope-domains-summary").textContent =
      "Show the " + formatCount(domains.length) + " domains affected";
    details.open = false;
    details.hidden = false;
  }

  el("delete-button").disabled = false;
}

// --- delete flow -----------------------------------------------------------

function cancelConfirm() {
  el("confirm-row").hidden = true;
  el("delete-button").hidden = false;
}

function startConfirm() {
  const { count, domains } = summarise(scopeCookies);

  el("confirm-text").textContent =
    "Delete " +
    pluralise(count, "cookie", "cookies") +
    (domains.length === 1 ? " from " + domains[0] : " from " + pluralise(domains.length, "domain", "domains")) +
    "?";

  el("delete-result").hidden = true;
  el("delete-button").hidden = true;
  el("confirm-row").hidden = false;
  el("confirm-yes").focus();
}

async function runDelete() {
  const result = el("delete-result");
  const yes = el("confirm-yes");
  const no = el("confirm-no");

  yes.disabled = true;
  no.disabled = true;
  result.hidden = false;
  result.className = "result";
  result.textContent = "Deleting…";

  try {
    const { removed, failed } = await removeCookies(scopeCookies);

    if (failed.length === 0) {
      result.textContent = "Deleted " + pluralise(removed, "cookie", "cookies") + ".";
    } else {
      // Report honestly rather than claiming a clean sweep.
      result.className = "result error";
      result.textContent =
        "Deleted " +
        pluralise(removed, "cookie", "cookies") +
        ". " +
        pluralise(failed.length, "cookie", "cookies") +
        " could not be deleted — they may be protected by the browser.";
    }
  } catch (error) {
    result.className = "result error";
    result.textContent = "The delete failed: " + error.message;
  } finally {
    yes.disabled = false;
    no.disabled = false;
    cancelConfirm();
    await refresh();
  }
}

// --- create / edit ---------------------------------------------------------

// A short message above the delete panel, for things that happened on the
// main screen (a cookie saved, a single cookie deleted).
function showMainMessage(text, isError) {
  const message = el("main-message");
  message.textContent = text;
  message.className = isError ? "result error" : "result";
  message.hidden = false;
}

// Open the form. `cookie` is the one being edited, or null to create.
function openEditor(cookie) {
  editing = cookie || null;

  el("main-message").hidden = true;
  el("edit-title").textContent = cookie ? "Edit cookie" : "New cookie";
  el("edit-errors").hidden = true;
  el("edit-errors").textContent = "";

  const isNew = !cookie;
  const secure = isNew ? page.origin.startsWith("https:") : Boolean(cookie.secure);

  el("field-name").value = isNew ? "" : cookie.name;
  el("field-value").value = isNew ? "" : cookie.value;

  // The stored domain carries a leading dot when the cookie is domain-wide
  // (".example.com"). Showing that next to a Host-only checkbox would say the
  // same thing twice, in two notations, so the dot is stripped here and the
  // checkbox carries the meaning. buildSetDetails() puts it back.
  el("field-domain").value = isNew
    ? page.hostname
    : String(cookie.domain || "").replace(/^\./, "");
  el("field-path").value = isNew ? "/" : cookie.path || "/";

  el("field-samesite").value = isNew ? "unspecified" : cookie.sameSite || "unspecified";
  el("field-secure").checked = secure;
  el("field-httponly").checked = isNew ? false : Boolean(cookie.httpOnly);

  // A new cookie defaults to host-only: the narrower of the two, and what a
  // page gets when it sets a cookie without a Domain attribute.
  el("field-hostonly").checked = isNew ? true : Boolean(cookie.hostOnly);

  // A new cookie defaults to a session cookie, so adding one can't
  // accidentally leave something permanent behind.
  const isSession = isNew || typeof cookie.expirationDate !== "number";
  el("field-session").checked = isSession;
  el("field-expiry").value = isSession
    ? ""
    : toLocalDateTimeValue(cookie.expirationDate);
  syncExpiryEnabled();

  // Partitioned cookies are carried through a save untouched. The partition
  // isn't editable here — there's no safe way to offer that without a much
  // longer explanation than this popup has room for.
  const partition = el("edit-partition");
  if (cookie && cookie.partitionKey) {
    partition.textContent =
      "This is a partitioned (CHIPS) cookie. Its partition is kept as it is when you save.";
    partition.hidden = false;
  } else {
    partition.hidden = true;
  }

  showState("edit");
  el("field-name").focus();
}

function closeEditor() {
  editing = null;
  showState("main");
}

// The expiry field is meaningless while "session cookie" is ticked.
function syncExpiryEnabled() {
  el("field-expiry").disabled = el("field-session").checked;
}

function readForm() {
  const session = el("field-session").checked;

  return {
    name: el("field-name").value.trim(),
    value: el("field-value").value,
    domain: el("field-domain").value.trim(),
    path: el("field-path").value.trim() || "/",
    sameSite: el("field-samesite").value,
    secure: el("field-secure").checked,
    httpOnly: el("field-httponly").checked,
    hostOnly: el("field-hostonly").checked,
    session,
    expirationDate: session ? null : fromLocalDateTimeValue(el("field-expiry").value),
    // Carried straight through from the cookie being edited.
    storeId: editing ? editing.storeId : undefined,
    partitionKey: editing ? editing.partitionKey : undefined,
  };
}

function showFormErrors(errors) {
  const list = el("edit-errors");
  list.textContent = "";

  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    list.appendChild(item);
  }

  list.hidden = errors.length === 0;
}

// Chrome caps how far ahead a cookie may expire — 400 days at the time of
// writing — and it applies the cap silently: ask for 2030 and it stores a
// date about thirteen months out without a word. Saying "Saved" and leaving
// it there would be claiming something that didn't happen, so compare what
// Chrome actually stored against what was asked for and report the gap.
//
// Deliberately compares the two dates rather than hardcoding 400 days, so
// this keeps telling the truth if Chrome changes the limit.
function describeExpiryChange(values, saved) {
  if (!saved || values.session || typeof values.expirationDate !== "number") {
    return "";
  }
  if (typeof saved.expirationDate !== "number") {
    return "";
  }

  // A minute of slack: Chrome stores fractional seconds, and an unclamped
  // date comes back as the one that was asked for.
  if (Math.abs(saved.expirationDate - values.expirationDate) < 60) {
    return "";
  }

  return (
    " Chrome shortened the expiry to " +
    formatExpiryFull({ expirationDate: saved.expirationDate }).replace(/^Expires /, "") +
    " — it limits how far ahead a cookie is allowed to expire."
  );
}

async function saveEditor() {
  const values = readForm();

  // Checked here rather than letting Chrome refuse the write, because its own
  // rejection message names the cookie but never the rule it broke.
  const errors = validateCookieValues(values);
  if (errors.length > 0) {
    showFormErrors(errors);
    return;
  }
  showFormErrors([]);

  const save = el("edit-save");
  save.disabled = true;

  try {
    const { ok, cookie, error } = await writeCookie(editing, values);

    if (!ok) {
      showFormErrors([error]);
      return;
    }

    const wasEditing = Boolean(editing);
    closeEditor();
    showMainMessage(
      (wasEditing ? "Saved changes to " + values.name + "." : "Created " + values.name + ".") +
        describeExpiryChange(values, cookie),
      false
    );
    await refresh();
  } catch (error) {
    // writeCookie handles its own failures, so reaching here means something
    // unexpected. Say so rather than leaving the form looking stuck.
    showFormErrors([error && error.message ? error.message : String(error)]);
  } finally {
    save.disabled = false;
  }
}

// --- keeping cookies -------------------------------------------------------

async function toggleProtected(cookie, shouldKeep) {
  const { keys, error } = await setProtected(cookie, shouldKeep);
  protectedKeys = keys;

  if (error) {
    showMainMessage(error, true);
    return;
  }

  showMainMessage(
    shouldKeep
      ? "Keeping " + cookie.name + ". It won't be deleted from here until you say otherwise."
      : "No longer keeping " + cookie.name + ".",
    false
  );

  // The table shows the new state, and the scope count has to change with it.
  drawTable();
  await refreshScope();
}

// Delete a single cookie from its row. The row has already asked for a second
// click, so this runs straight away.
async function deleteOne(cookie) {
  // The row's Delete button is disabled for a kept cookie, but check anyway:
  // a stale row could outlive the state it was drawn from.
  if (isProtected(protectedKeys, cookie)) {
    showMainMessage(
      cookie.name + " is being kept, so it wasn't deleted. Click Kept first if you want it gone.",
      true
    );
    return;
  }

  const ok = await removeCookie(cookie);

  showMainMessage(
    ok
      ? "Deleted " + cookie.name + "."
      : "Couldn't delete " + cookie.name + ". It may be protected by the browser.",
    !ok
  );

  await refresh();
}

// --- events ----------------------------------------------------------------

el("grant-button").addEventListener("click", async () => {
  const message = el("gate-message");
  message.hidden = true;

  // Must be called straight from the click: Chrome rejects permission
  // requests that aren't tied to a user gesture.
  const { granted, error } = await requestHostAccess();

  if (error) {
    message.textContent = error;
    message.hidden = false;
    return;
  }

  if (!granted) {
    message.textContent =
      "Access was declined, so cookies can't be listed. Click Grant access to try again.";
    message.hidden = false;
    return;
  }

  showState("loading");
  try {
    await loadCurrentPage();
  } catch (loadError) {
    showError(loadError);
  }
});

el("retry-button").addEventListener("click", init);
el("refresh-button").addEventListener("click", refresh);

// Typing filters what's already loaded, so this is only a redraw plus a
// recount -- no cookie query per keystroke.
el("search-input").addEventListener("input", () => {
  drawTable();
  refreshScope();
});

el("search-clear").addEventListener("click", () => {
  el("search-input").value = "";
  drawTable();
  refreshScope();
  el("search-input").focus();
});

el("add-button").addEventListener("click", () => openEditor(null));
el("edit-cancel").addEventListener("click", closeEditor);
el("edit-cancel-2").addEventListener("click", closeEditor);
el("field-session").addEventListener("change", syncExpiryEnabled);

el("edit-form").addEventListener("submit", (event) => {
  // The form never navigates; submitting is just the Enter key reaching Save.
  event.preventDefault();
  saveEditor();
});

for (const radio of document.querySelectorAll('input[name="scope"]')) {
  radio.addEventListener("change", () => {
    el("delete-result").hidden = true;
    refreshScope();
  });
}

el("delete-button").addEventListener("click", startConfirm);
el("confirm-no").addEventListener("click", cancelConfirm);
el("confirm-yes").addEventListener("click", runDelete);

init();
