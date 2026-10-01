// Runs the popup: picks which screen to show, loads the cookies, and handles
// deleting, editing, keeping, exporting and importing.

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
  getAllCookies,
} from "../lib/cookies.js";
import {
  toJson,
  toNetscape,
  toHeader,
  toPlaywright,
  toCurl,
  parseImport,
  planImport,
} from "../lib/transfer.js";
import { copyWithFeedback } from "./clipboard.js";
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
  choiceFor,
  mirror,
  watchSystemTheme,
} from "../lib/theme.js";
import { renderCookieTable } from "./render.js";
import {
  saveLastDelete,
  loadLastDelete,
  clearLastDelete,
  restoreCookies,
  describeAge,
} from "../lib/undo.js";

// The site in the current tab, as { origin, hostname }.
let page = null;

// The cookies the chosen scope will delete. The count on screen comes from
// this same list, so the number shown always matches what gets deleted.
let scopeCookies = [];

// Every cookie in the chosen scope, kept ones included. This is what Export
// exports: keeping a cookie stops it being deleted, not copied.
let scopeAll = [];

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

// Opened with "Open in a tab", the page is popup.html?tab=<id>, where <id> is
// the tab it was opened from. Otherwise it's the toolbar popup.
const targetTabId = Number(new URLSearchParams(location.search).get("tab")) || null;
const inTab = targetTabId !== null;
if (inTab) {
  document.body.classList.add("in-tab");
}

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

// The tab whose cookies are shown: the active tab in the popup, or the tab
// it was opened from when it's open in a tab of its own.
async function getTargetTab() {
  if (!inTab) {
    return await getActiveTab();
  }
  try {
    return await chrome.tabs.get(targetTabId);
  } catch (error) {
    return null;
  }
}

async function loadCurrentPage() {
  const tab = await getTargetTab();

  if (!tab && inTab) {
    showBlocked("The tab this was opened from has been closed.");
    return;
  }
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
  if (inTab) {
    document.title = "cookieZ - " + url.hostname;
  }
  el("scope-target-page").textContent = url.hostname;
  el("scope-target-domain").textContent = baseHostOf(url.hostname);

  showState("main");
  await refresh();
  await offerStoredUndo();
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
  el("export-button").disabled = true;
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
    scopeAll = [];
    summaryLine.textContent = "Couldn't count the cookies in this scope: " + error.message;
    return;
  }

  scopeAll = inScope;
  el("export-button").disabled = inScope.length === 0;

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
  el("export-button").hidden = false;
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
  el("export-button").hidden = true;
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
    const { removed, removedCookies, failed } = await removeCookies(scopeCookies);

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
    await offerUndo(result, removedCookies);
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
  if (ok) {
    await offerUndo(el("main-message"), [cookie]);
  }

  await refresh();
}

// --- undo ------------------------------------------------------------------

// Remembers what a delete removed and adds an Undo button to its message.
// Setting the message's text later removes the button. That's fine: the
// delete can still be undone from the next open, for up to 10 minutes.
async function offerUndo(message, removedCookies) {
  if (removedCookies.length === 0) {
    return;
  }
  const { error } = await saveLastDelete(removedCookies);
  if (error) {
    message.append(" " + error);
    return;
  }
  appendUndoButton(message);
}

function appendUndoButton(message) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-button undo-button";
  button.textContent = "Undo";
  button.addEventListener("click", () => runUndo(message, button));
  message.append(" ", button);
}

// On opening, offer to undo a delete made in the last 10 minutes, unless
// something more important is already showing.
async function offerStoredUndo() {
  const last = await loadLastDelete();
  if (!last || !el("main-message").hidden) {
    return;
  }

  // "example.com" and ".example.com" are the same site to a reader.
  const count = last.cookies.length;
  const sites = Array.from(
    new Set(last.cookies.map((cookie) => String(cookie.domain || "").replace(/^\./, "")))
  );
  const what = count === 1 ? last.cookies[0].name : pluralise(count, "cookie", "cookies");
  const where =
    sites.length === 1 ? " from " + sites[0] : " across " + pluralise(sites.length, "site", "sites");

  showMainMessage(
    "Deleted " + what + where + " " + describeAge(Date.now() / 1000 - last.at) + ".",
    false
  );
  appendUndoButton(el("main-message"));
}

async function runUndo(message, button) {
  button.disabled = true;

  const last = await loadLastDelete();
  if (!last) {
    message.className = "result error";
    message.textContent = "There's nothing to undo. Undo only lasts 10 minutes after a delete.";
    return;
  }

  message.className = "result";
  message.textContent = "Restoring…";

  const { restored, expired, failures } = await restoreCookies(last.cookies);
  await clearLastDelete();

  const parts = ["Restored " + pluralise(restored, "cookie", "cookies") + "."];
  if (expired > 0) {
    parts.push(
      pluralise(expired, "cookie has", "cookies have") +
        " expired since, so " +
        (expired === 1 ? "it wasn't" : "they weren't") +
        " put back."
    );
  }
  if (failures.length > 0) {
    parts.push(
      "Chrome refused " + pluralise(failures.length, "cookie", "cookies") + ": " + failures.join(" ")
    );
  }
  message.className = failures.length > 0 ? "result error" : "result";
  message.textContent = parts.join(" ");

  await refresh();
}

// --- export ----------------------------------------------------------------

function selectedFormat() {
  const checked = document.querySelector('input[name="format"]:checked');
  return checked ? checked.value : "json";
}

// The export for the chosen format, and the file name to download it as.
function buildExport() {
  const format = selectedFormat();
  const date = new Date().toISOString().slice(0, 10);
  const scopeName = {
    page: page.hostname,
    domain: baseHostOf(page.hostname),
    all: "all-sites",
    matches: page.hostname + "-search",
  }[selectedScope()];
  const base = "cookies-" + scopeName + "-" + date;

  if (format === "netscape") {
    return { text: toNetscape(scopeAll), filename: base + ".txt", type: "text/plain" };
  }
  if (format === "header") {
    return { text: toHeader(scopeAll), filename: base + "-header.txt", type: "text/plain" };
  }
  if (format === "curl") {
    return { text: toCurl(scopeAll, page.origin + "/"), filename: base + "-curl.sh", type: "text/plain" };
  }
  if (format === "playwright") {
    return { text: toPlaywright(scopeAll), filename: base + "-playwright.json", type: "application/json" };
  }
  return { text: toJson(scopeAll), filename: base + ".json", type: "application/json" };
}

function openExport() {
  const { count, domains } = summarise(scopeAll);
  const kept = scopeAll.length - scopeCookies.length;

  el("export-summary").textContent =
    pluralise(count, "cookie", "cookies") +
    (domains.length === 1 ? " from " + domains[0] : " from " + pluralise(domains.length, "domain", "domains")) +
    (kept > 0 ? ", including " + pluralise(kept, "kept cookie", "kept cookies") : "") +
    ".";

  // The Cookie header and curl both send cookies to one page, so they're
  // only offered when the cookies are one page's.
  const onePage = exportIsOnePage(domains);
  const onePageFormats = [
    ["header", "Names and values only, as a browser sends them to this page."],
    ["curl", "Sends these cookies to this page, for bash or zsh."],
  ];
  for (const [format, note] of onePageFormats) {
    const radio = document.querySelector('input[name="format"][value="' + format + '"]');
    radio.disabled = !onePage;
    el(format + "-note").textContent = onePage
      ? note
      : "Only for the cookies of one page. Choose “This page” to use it.";
    if (!onePage && radio.checked) {
      document.querySelector('input[name="format"][value="json"]').checked = true;
    }
  }

  el("export-result").hidden = true;
  el("main-message").hidden = true;
  showExportText();
  showState("export");
  el("export-copy").focus();
}

// Whether the cookies being exported are what a browser sends to one page.
// "This page" (and a search within it) is exactly that set, even when it
// mixes example.com and www.example.com cookies. The wider scopes only
// qualify when every cookie has the same domain.
function exportIsOnePage(domains) {
  return (
    selectedScope() === "page" ||
    selectedScope() === "matches" ||
    new Set(domains.map((d) => d.replace(/^\./, ""))).size <= 1
  );
}

function showExportText() {
  el("export-output").value = buildExport().text;
}

function downloadExport() {
  const { text, filename, type } = buildExport();

  // A download made from the page itself. No downloads permission needed.
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  const result = el("export-result");
  result.className = "result";
  result.textContent = "Saving as " + filename + ".";
  result.hidden = false;
}

// --- import ----------------------------------------------------------------

// What the preview said will be written. Import writes exactly this list.
let importPlan = null;

function openImport() {
  el("main-message").hidden = true;
  el("import-file-row").hidden = !inTab;
  el("import-file-hint").hidden = inTab;
  resetImportPreview();
  el("import-result").hidden = true;
  el("import-failures").hidden = true;
  showState("import");
  el("import-text").focus();
}

function resetImportPreview() {
  importPlan = null;
  el("import-preview").hidden = true;
}

function fillList(list, items) {
  list.textContent = "";
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text; // comes from a file, so never innerHTML
    list.appendChild(item);
  }
  list.hidden = items.length === 0;
}

async function checkImport() {
  el("import-result").hidden = true;
  el("import-failures").hidden = true;
  resetImportPreview();

  const { entries, problems } = parseImport(el("import-text").value);

  let existing;
  try {
    existing = await getAllCookies();
  } catch (error) {
    showImportResult("Couldn't read your current cookies to compare: " + error.message, true);
    return;
  }

  const plan = planImport(
    entries,
    existing,
    (cookie) => isProtected(protectedKeys, cookie),
    Date.now() / 1000
  );

  const count = plan.toWrite.length;
  const replacing = plan.toWrite.filter((item) => item.replaces).length;
  const kept = plan.toWrite.filter((item) => item.kept).length;

  const parts = [];
  if (count === 0) {
    parts.push("Nothing can be imported.");
  } else {
    parts.push(
      "Will add " +
        pluralise(count, "cookie", "cookies") +
        (plan.domains.length === 1
          ? " for " + plan.domains[0]
          : " across " + pluralise(plan.domains.length, "site", "sites")) +
        "."
    );
    if (replacing > 0) {
      parts.push(
        formatCount(replacing) +
          (replacing === 1 ? " of them replaces a cookie" : " of them replace cookies") +
          " you already have."
      );
    }
    if (kept > 0) {
      parts.push(
        formatCount(kept) + (kept === 1 ? " of those is a kept cookie." : " of those are kept cookies.")
      );
    }
  }
  if (plan.expired > 0) {
    parts.push(
      pluralise(plan.expired, "cookie has", "cookies have") + " already expired and will be skipped."
    );
  }
  if (plan.duplicates > 0) {
    parts.push(pluralise(plan.duplicates, "duplicate", "duplicates") + " in the file will be skipped.");
  }
  el("import-summary").textContent = parts.join(" ");

  if (plan.domains.length > 1) {
    fillList(el("import-domains-list"), plan.domains);
    el("import-domains-summary").textContent = "Show the " + formatCount(plan.domains.length) + " sites";
    el("import-domains").open = false;
    el("import-domains").hidden = false;
  } else {
    el("import-domains").hidden = true;
  }

  const skipped = [...problems, ...plan.invalid.map((text) => "Will be skipped: " + text)];
  fillList(el("import-problems"), skipped);

  el("import-confirm").textContent = "Import " + pluralise(count, "cookie", "cookies");
  el("import-confirm-row").hidden = count === 0;
  el("import-preview").hidden = false;
  importPlan = count > 0 ? plan : null;
  if (importPlan) {
    el("import-confirm").focus();
  }
}

function showImportResult(text, isError) {
  const result = el("import-result");
  result.textContent = text;
  result.className = isError ? "result error" : "result";
  result.hidden = false;
}

async function runImport() {
  if (!importPlan) {
    return;
  }
  const plan = importPlan;
  resetImportPreview();
  showImportResult("Importing…", false);

  let created = 0;
  let replaced = 0;
  let shortened = 0;
  const failures = [];

  // One at a time, so the result for each cookie is known.
  for (const { entry, replaces } of plan.toWrite) {
    const { ok, cookie, error } = await writeCookie(null, entry);
    if (!ok) {
      failures.push(entry.name + " (" + entry.domain + "): " + error);
      continue;
    }
    if (replaces) {
      replaced += 1;
    } else {
      created += 1;
    }
    if (describeExpiryChange(entry, cookie)) {
      shortened += 1;
    }
  }

  const parts = [
    "Imported " +
      pluralise(created + replaced, "cookie", "cookies") +
      (replaced > 0 ? " (" + formatCount(replaced) + " replaced)" : "") +
      ".",
  ];
  if (shortened > 0) {
    parts.push(
      "Chrome shortened the expiry of " +
        pluralise(shortened, "cookie", "cookies") +
        ", because it limits how far ahead a cookie can expire."
    );
  }
  if (failures.length > 0) {
    parts.push("Chrome refused " + pluralise(failures.length, "cookie", "cookies") + ":");
  }
  showImportResult(parts.join(" "), failures.length > 0);
  fillList(el("import-failures"), failures);
}

async function readImportFile() {
  const file = el("import-file").files[0];
  if (!file) {
    return;
  }
  try {
    el("import-text").value = await file.text();
    await checkImport();
  } catch (error) {
    showImportResult("Couldn't read " + file.name + ": " + error.message, true);
  }
}

async function closeImport() {
  showState("main");
  await refresh();
}

// --- open in a tab ---------------------------------------------------------

async function openInTab() {
  const tab = await getActiveTab();
  if (!tab) {
    showMainMessage("Couldn't tell which tab this is for.", true);
    return;
  }
  await chrome.tabs.create({
    url: chrome.runtime.getURL("popup/popup.html") + "?tab=" + tab.id,
  });
  window.close();
}

// --- theme -----------------------------------------------------------------

// "light" or "dark" if someone picked one, or null to follow the system. The
// system-theme listener below only changes the theme when this is null.
let themeChoice = null;

// Selects the Light or Dark button for the theme showing. apply-theme.js has
// set data-theme before this first runs, so a button is selected from the
// start.
function showThemeButton() {
  const showing = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const radio = document.querySelector('input[name="theme"][value="' + showing + '"]');
  if (radio) {
    radio.checked = true;
  }
}

async function initTheme() {
  const { choice, error } = await loadTheme();
  themeChoice = choice;

  // apply-theme.js already set the theme from the localStorage copy. Apply it
  // again from the saved value in case the two differ.
  applyTheme(choice);
  mirror(choice);
  showThemeButton();

  if (error) {
    showMainMessage(error, true);
  }
}

async function chooseTheme(theme) {
  themeChoice = choiceFor(theme);

  const { error } = await saveTheme(theme);
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
// In a tab, the other tab may have moved to another site, so read its address
// again too.
el("refresh-button").addEventListener("click", () => (inTab ? loadCurrentPage() : refresh()));
el("tab-button").hidden = inTab;
el("tab-button").addEventListener("click", openInTab);
el("import-tab").addEventListener("click", openInTab);

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
el("export-button").addEventListener("click", openExport);
el("export-back").addEventListener("click", () => showState("main"));
el("export-copy").addEventListener("click", () =>
  copyWithFeedback(el("export-copy"), el("export-output").value)
);
el("export-download").addEventListener("click", downloadExport);
for (const radio of document.querySelectorAll('input[name="format"]')) {
  radio.addEventListener("change", showExportText);
}

el("import-button").addEventListener("click", openImport);
el("import-back").addEventListener("click", closeImport);
el("import-check").addEventListener("click", checkImport);
el("import-confirm").addEventListener("click", runImport);
el("import-cancel").addEventListener("click", resetImportPreview);
el("import-file").addEventListener("change", readImportFile);
// A changed paste has to be checked again before it can be imported.
el("import-text").addEventListener("input", resetImportPreview);

el("value-copy").addEventListener("click", () =>
  copyWithFeedback(el("value-copy"), el("field-value").value)
);
el("confirm-no").addEventListener("click", cancelConfirm);
el("confirm-yes").addEventListener("click", runDelete);

for (const radio of document.querySelectorAll('input[name="theme"]')) {
  radio.addEventListener("change", () => chooseTheme(radio.value));
}

// Follow the system theme while the popup is open, unless someone picked one.
watchSystemTheme(() => {
  if (!themeChoice) {
    applyTheme(null);
    showThemeButton();
  }
});

// Not awaited, so loading cookies doesn't wait for it. The theme is already
// showing thanks to apply-theme.js.
showThemeButton();
initTheme();

init();
