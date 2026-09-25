// Runs the popup: picks which screen to show, loads the cookies, and handles
// deleting, editing and keeping.

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
import {
  loadTheme,
  saveTheme,
  applyTheme,
  mirror,
  watchSystemTheme,
} from "../lib/theme.js";
import { renderCookieTable } from "./render.js";

// The site in the current tab, as { origin, hostname }.
let page = null;

// The cookies the chosen scope will delete. The count on screen comes from
// this same list, so the number shown always matches what gets deleted.
let scopeCookies = [];

// The cookie open in the editor, or null for a new one. Saving needs the
// original cookie, in case the name or path changed. See writeCookie().
let editing = null;

// All of this page's cookies, and the ones the search is showing.
// "Just the cookies shown" deletes shownCookies, the same list as the table.
let pageCookies = [];
let shownCookies = [];

// The cookies the user has marked as Kept. See src/lib/protect.js.
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

  // Pages like chrome:// and the Web Store can't have their cookies read.
  // Say so, instead of showing an empty table that looks broken.
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

// Reloads the table, then the delete count. These must run one after the
// other. refreshScope() uses the Kept list that refreshTable() loads, and
// running them together once let a delete remove a cookie shown as kept.
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
      // Must be shown: a cookie the user thinks is kept could get deleted.
      showMainMessage(error, true);
    }

    // Forget Kept entries for cookies that are gone. See pruneProtected().
    const domains = new Set(pageCookies.map((c) => String(c.domain || "").replace(/^\./, "")));
    domains.add(page.hostname);
    const pruned = await pruneProtected(protectedKeys, pageCookies, domains);
    protectedKeys = pruned.keys;

    drawTable();
  } catch (error) {
    showError(error);
  }
}

// Applies the search and draws the table. It filters the cookies already
// loaded, so typing doesn't ask Chrome again on every key press.
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

  // "Just the cookies shown" only appears while searching.
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
    // "matches" deletes exactly the rows on screen, so it uses the table's
    // own list rather than asking Chrome again.
    inScope =
      selectedScope() === "matches"
        ? shownCookies
        : await getCookiesForScope(selectedScope(), page);
  } catch (error) {
    scopeCookies = [];
    summaryLine.textContent = "Couldn't count the cookies in this scope: " + error.message;
    return;
  }

  // Kept cookies are taken out before counting, so the number shown is still
  // exactly what will be deleted.
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
        ? "Nothing to delete in this scope." + keptNote
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

  // List every domain, so the user sees exactly what will go first.
  if (domains.length > 1) {
    const list = el("scope-domains-list");
    list.textContent = "";
    for (const domain of domains) {
      const item = document.createElement("li");
      item.textContent = domain; // comes from websites, so never innerHTML
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
      result.className = "result error";
      result.textContent =
        "Deleted " +
        pluralise(removed, "cookie", "cookies") +
        ". " +
        pluralise(failed.length, "cookie", "cookies") +
        " could not be deleted, and may be protected by the browser.";
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

// A short message above the delete panel, such as "Deleted session_id."
function showMainMessage(text, isError) {
  const message = el("main-message");
  message.textContent = text;
  message.className = isError ? "result error" : "result";
  message.hidden = false;
}

// Opens the editor. `cookie` is the one to edit, or null for a new one.
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

  // A domain-wide cookie is stored with a leading dot (".example.com"). The
  // dot is hidden here because the Host-only checkbox already shows that.
  // buildSetDetails() puts it back when saving.
  el("field-domain").value = isNew
    ? page.hostname
    : String(cookie.domain || "").replace(/^\./, "");
  el("field-path").value = isNew ? "/" : cookie.path || "/";

  el("field-samesite").value = isNew ? "unspecified" : cookie.sameSite || "unspecified";
  el("field-secure").checked = secure;
  el("field-httponly").checked = isNew ? false : Boolean(cookie.httpOnly);

  // New cookies start as host-only, the same as a website's default.
  el("field-hostonly").checked = isNew ? true : Boolean(cookie.hostOnly);

  // New cookies start as session cookies, so nothing permanent is left behind
  // by accident.
  const isSession = isNew || typeof cookie.expirationDate !== "number";
  el("field-session").checked = isSession;
  el("field-expiry").value = isSession
    ? ""
    : toLocalDateTimeValue(cookie.expirationDate);
  syncExpiryEnabled();

  // A partitioned cookie keeps its partition when saved. The partition can't
  // be edited here.
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

// No expiry date while "Session cookie" is ticked.
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

// Chrome won't let a cookie expire more than about 400 days ahead. If you ask
// for longer, it quietly shortens it. This compares what was saved with what
// was asked for, and returns a note if Chrome changed it. It doesn't assume
// 400 days, so it still works if Chrome changes the limit.
function describeExpiryChange(values, saved) {
  if (!saved || values.session || typeof values.expirationDate !== "number") {
    return "";
  }
  if (typeof saved.expirationDate !== "number") {
    return "";
  }

  // Allow a minute's difference, because Chrome stores fractions of a second.
  if (Math.abs(saved.expirationDate - values.expirationDate) < 60) {
    return "";
  }

  return (
    " Chrome shortened the expiry to " +
    formatExpiryFull({ expirationDate: saved.expirationDate }).replace(/^Expires /, "") +
    " It limits how far ahead a cookie is allowed to expire."
  );
}

async function saveEditor() {
  const values = readForm();

  // Check first, because Chrome's own error doesn't say what's wrong.
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
    // Shouldn't happen, since writeCookie() catches its own errors. Show it
    // anyway so the form doesn't look stuck.
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

  // Redraw, and recount, since kept cookies aren't deleted.
  drawTable();
  await refreshScope();
}

// Deletes one cookie from its row. The row already asked "Sure?".
async function deleteOne(cookie) {
  // The button is disabled for kept cookies, but check again in case the
  // table is out of date.
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

// --- theme -----------------------------------------------------------------

// "auto", "light" or "dark". The system-theme listener below needs to know,
// so it only changes the theme when this is "auto".
let themeChoice = "auto";

async function initTheme() {
  const { choice, error } = await loadTheme();
  themeChoice = choice;

  // apply-theme.js already set the theme from the localStorage copy. Apply it
  // again from the saved value in case the two differ.
  applyTheme(choice);
  mirror(choice);

  const radio = document.querySelector('input[name="theme"][value="' + choice + '"]');
  if (radio) {
    radio.checked = true;
  }

  if (error) {
    showMainMessage(error, true);
  }
}

async function chooseTheme(choice) {
  themeChoice = choice;

  const { error } = await saveTheme(choice);
  if (error) {
    showMainMessage(error, true);
  }
}

// --- events ----------------------------------------------------------------

el("grant-button").addEventListener("click", async () => {
  const message = el("gate-message");
  message.hidden = true;

  // Has to run straight from the click, or Chrome won't show the prompt.
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
  // Pressing Enter in the form saves, without reloading the page.
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

for (const radio of document.querySelectorAll('input[name="theme"]')) {
  radio.addEventListener("change", () => chooseTheme(radio.value));
}

// Follow the system theme while the popup is open, but only on "auto".
watchSystemTheme(() => {
  if (themeChoice === "auto") {
    applyTheme("auto");
  }
});

// Not awaited, so loading cookies doesn't wait for it. The theme is already
// showing thanks to apply-theme.js.
initTheme();

init();
