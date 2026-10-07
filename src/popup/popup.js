// Runs the popup: picks which screen to show, loads the cookies, and handles
// deleting, editing, keeping, exporting and importing.

import { hasHostAccess, requestHostAccess } from "../lib/permissions.js";
import {
  getCookiesForPage,
  getCookiesForScope,
  removeCookie,
  removeCookies,
  writeCookie,
  validateCookieValues,
  filterCookies,
  filterByFlags,
  passesFilter,
  baseHostOf,
  getAllCookies,
  cookieKey,
  sitesOf,
  MAX_COOKIE_BYTES,
} from "../lib/cookies.js";
import {
  toJson,
  toNetscape,
  toHeader,
  toPlaywright,
  toCurl,
  parseImport,
  planImport,
  matchSentCookies,
  isForSite,
  moveToSite,
} from "../lib/transfer.js";
import { copyWithFeedback } from "./clipboard.js";
import {
  loadProtected,
  setProtected,
  isProtected,
  partitionByProtection,
  pruneProtected,
  listProtected,
  unprotectKeys,
} from "../lib/protect.js";
import {
  pluralise,
  formatCount,
  headerBytes,
  cookieBytes,
  LARGE_COOKIE_BYTES,
  formatBytes,
  formatExpiryFull,
  toLocalDateTimeValue,
  fromLocalDateTimeValue,
  decodeValue,
} from "../lib/format.js";
import {
  loadTheme,
  saveTheme,
  applyTheme,
  choiceFor,
  mirror,
  watchSystemTheme,
} from "../lib/theme.js";
import { renderCookieTable, DEFAULT_SORT } from "./render.js";
import {
  saveLastChange,
  loadLastChange,
  clearLastChange,
  undoChange,
  describeAge,
} from "../lib/undo.js";

// The site in the current tab, as { origin, hostname }.
let page = null;

// Long values opened in the table, by cookie key, so they stay open when the
// table is drawn again.
let expanded = new Set();

// For marking rows the site has just added or changed: each cookie's key and
// what it looked like at the last load, then what's different this time.
// See refreshTable().
let seenCookies = null;
let changedKeys = new Set();
let lastChange = { added: 0, changed: 0, removed: 0 };

// What has happened to this site's cookies while cookieZ has been open,
// newest first, for the "What changed" screen: { at, name, domain, what }.
// Names only, never values. In memory only, so it's gone when cookieZ
// closes, and it starts again if the tab moves to another site.
let changeLog = [];
const CHANGE_LOG_LIMIT = 200;

// When a site changes a cookie, Chrome reports the old one being removed
// and then the new one being set. This remembers the first half, so the
// second can be listed as "Changed" and not "Added".
let overwritten = new Set();

// The row that's in the tab order. See setTabRow().
let tabRowKey = null;

// True while the editor is saving, so its own write isn't taken for the
// site changing the cookie.
let saving = false;

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

// How the table is sorted. Kept in memory only, so every open starts with
// the default.
let sort = DEFAULT_SORT;

// The cookies ticked in the table, as cookieKey()s. "Just the ticked
// cookies" deletes and exports exactly these. Kept in memory only.
let picked = new Set();

// The quick filters that are switched on, by name ("secure", "kept"...).
// Kept in memory only, so every open starts with none.
let activeFilters = new Set();

const el = (id) => document.getElementById(id);

// Above this, the popup warns that the site's cookies are getting too big.
const SIZE_WARNING_BYTES = 6 * 1024;

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

  // A different site: the list of changes starts again.
  if (!page || page.hostname !== url.hostname) {
    changeLog = [];
    overwritten = new Set();
  }

  page = { origin: url.origin, hostname: url.hostname };
  seenCookies = null;
  expanded = new Set();

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
    noteChanges(pageCookies);

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

// What a cookie looked like, to tell whether it changed between loads.
function fingerprintOf(cookie) {
  return [cookie.value, cookie.expirationDate, cookie.secure, cookie.httpOnly, cookie.sameSite].join("\n");
}

// Compares this load with the last one. Nothing is marked on the first load
// of a page, since everything would be new.
function noteChanges(cookies) {
  const previous = seenCookies;
  seenCookies = new Map(cookies.map((cookie) => [cookieKey(cookie), fingerprintOf(cookie)]));
  changedKeys = new Set();
  lastChange = { added: 0, changed: 0, removed: 0 };
  if (previous === null) {
    return;
  }

  for (const [key, fingerprint] of seenCookies) {
    if (!previous.has(key)) {
      changedKeys.add(key);
      lastChange.added += 1;
    } else if (previous.get(key) !== fingerprint) {
      changedKeys.add(key);
      lastChange.changed += 1;
    }
  }
  for (const key of previous.keys()) {
    if (!seenCookies.has(key)) {
      lastChange.removed += 1;
    }
  }
}

// Applies the search and draws the table. It filters the cookies already
// loaded, so typing doesn't ask Chrome again on every key press.
function drawTable() {
  const query = el("search-input").value;
  const isKept = (cookie) => isProtected(protectedKeys, cookie);
  shownCookies = filterByFlags(filterCookies(pageCookies, query), activeFilters, isKept);
  drawFilters(isKept);

  // Forget ticks and opened values for cookies that have gone, after a
  // delete for example.
  const onPage = new Set(pageCookies.map(cookieKey));
  picked = new Set([...picked].filter((key) => onPage.has(key)));
  expanded = new Set([...expanded].filter((key) => onPage.has(key)));

  const focus = focusInTable();
  const changed = changedKeys;
  // Only marked once. Typing in the search box redraws without them.
  changedKeys = new Set();

  renderCookieTable(el("cookie-rows"), shownCookies, {
    onEdit: openEditor,
    onDelete: deleteOne,
    onProtect: toggleProtected,
    isProtected: (cookie) => isProtected(protectedKeys, cookie),
    onPick: pickCookie,
    isPicked: (cookie) => picked.has(cookieKey(cookie)),
    isChanged: (cookie) => changed.has(cookieKey(cookie)),
    isExpanded: (cookie) => expanded.has(cookieKey(cookie)),
    onExpand: (cookie, open) => {
      if (open) {
        expanded.add(cookieKey(cookie));
      } else {
        expanded.delete(cookieKey(cookie));
      }
    },
  }, sort);
  setTabRow(tabRowKey);
  restoreFocus(focus);
  showPicked();
  showKeptLink();
  showChangesLink();

  if (changed.size > 0) {
    // Only the rows marked by this draw. Looking them up again when the
    // timer fires would also clear rows that a later draw has just marked.
    const marked = [...el("cookie-rows").querySelectorAll("tr.changed")];
    setTimeout(() => {
      for (const row of marked) {
        row.classList.remove("changed");
      }
    }, 3000);
  }

  const filtering = query.trim() !== "" || activeFilters.size > 0;
  el("search-clear").hidden = !filtering;

  // "about", because this page's list also has cookies for other paths,
  // which a browser only sends on those paths.
  const bytes = headerBytes(pageCookies);
  el("cookie-count").textContent =
    (filtering
      ? pluralise(shownCookies.length, "cookie", "cookies") +
        " of " + pluralise(pageCookies.length, "cookie", "cookies")
      : pluralise(pageCookies.length, "cookie", "cookies")) +
    (bytes > 0 ? " · about " + formatBytes(bytes) : "");

  // Many servers refuse requests with more than 8 KB of headers, and a site
  // that has piled up cookies is a common reason someone can't log in.
  const warning = el("size-warning");
  warning.hidden = bytes <= SIZE_WARNING_BYTES;
  warning.textContent = warning.hidden
    ? ""
    : "This site's cookies add up to about " +
      formatBytes(bytes) +
      ". Many servers refuse more than 8 KB, which can stop you logging in. " +
      "Deleting this site's cookies usually fixes it.";

  // "Just the cookies shown" only appears while searching or filtering.
  el("scope-matches-row").hidden = !filtering;
  el("scope-target-matches").textContent = filtering
    ? pluralise(shownCookies.length, "match", "matches")
    : "";

  if (!filtering && selectedScope() === "matches") {
    document.querySelector('input[name="scope"][value="page"]').checked = true;
  }

  const nothingAtAll = pageCookies.length === 0;
  const nothingMatched = !nothingAtAll && shownCookies.length === 0;

  el("empty-message").textContent = !nothingMatched
    ? "No cookies are set for this site."
    : query.trim() === ""
      ? "No cookies here match those filters."
      : activeFilters.size > 0
        ? "No cookies here match “" + query.trim() + "” and those filters."
        : "No cookies here match “" + query.trim() + "”.";
  el("empty-message").hidden = !(nothingAtAll || nothingMatched);
  el("cookie-table").hidden = nothingAtAll || nothingMatched;
}

// The quick filters. One that no cookie on this site matches is hidden,
// unless it's switched on, so it can always be switched off again.
function drawFilters(isKept) {
  let anyShown = false;
  for (const chip of document.querySelectorAll("#filters .chip")) {
    const name = chip.dataset.filter;
    const on = activeFilters.has(name);
    const matches = pageCookies.some((cookie) => passesFilter(cookie, name, isKept));
    chip.hidden = !on && !matches;
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    anyShown = anyShown || !chip.hidden;
  }
  el("filters").hidden = !anyShown;
}

function toggleFilter(name) {
  if (activeFilters.has(name)) {
    activeFilters.delete(name);
  } else {
    activeFilters.add(name);
  }
  drawTable();
  refreshScope();
}

// Clicking a heading sorts by it. Clicking it again reverses the order.
// Size starts with the biggest first, since that's the one people look for.
function sortBy(key) {
  const first = key === "size" ? "descending" : "ascending";
  sort =
    sort.key === key
      ? { key, dir: sort.dir === "ascending" ? "descending" : "ascending" }
      : { key, dir: first };

  for (const button of document.querySelectorAll("th button.sort")) {
    const heading = button.parentElement;
    if (button.dataset.sort === sort.key) {
      heading.setAttribute("aria-sort", sort.dir);
    } else {
      heading.removeAttribute("aria-sort");
    }
  }
  drawTable();
}

// --- keyboard --------------------------------------------------------------

// Only one row is in the tab order, so Tab doesn't stop on every row. The
// arrow keys move between rows. It's the last row that had focus, or the
// first.
function setTabRow(key) {
  const rows = [...el("cookie-rows").rows];
  const chosen = rows.find((row) => row.dataset.key === key) || rows[0];
  tabRowKey = chosen ? chosen.dataset.key : null;
  for (const row of rows) {
    row.tabIndex = row === chosen ? 0 : -1;
  }
}

// Where focus is in the table, so a redraw can put it back. See
// restoreFocus().
function focusInTable() {
  const active = document.activeElement;
  const row = active && active.closest ? active.closest("#cookie-rows tr") : null;
  if (!row) {
    return null;
  }
  const control = ["button.keep", "button.edit", "td.pick input"].find((selector) => active.matches(selector));
  return {
    key: row.dataset.key,
    index: [...el("cookie-rows").rows].indexOf(row),
    control: control || null,
  };
}

// Puts focus back on the same cookie, and the same button on it, if it's
// still there. If it's gone, such as after a delete, focus goes to the row
// that took its place, so the next key press carries on down the list.
function restoreFocus(where) {
  if (!where) {
    return;
  }
  const rows = [...el("cookie-rows").rows];
  if (rows.length === 0) {
    el("search-input").focus();
    return;
  }
  const same = rows.find((row) => row.dataset.key === where.key);
  const row = same || rows[Math.min(where.index, rows.length - 1)];
  const control = same && where.control ? row.querySelector(where.control) : null;
  (control || row).focus();
}

function cookieForRow(row) {
  return shownCookies.find((cookie) => cookieKey(cookie) === row.dataset.key) || null;
}

// The keys on a row with focus. Keys pressed on the row's own buttons do
// what those buttons do, apart from Esc, which cancels "Sure?".
function onTableKey(event) {
  const row = event.target.closest("tr");
  if (!row || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === "Escape") {
    const cancel = row.querySelector("button.cancel:not([hidden])");
    if (cancel) {
      event.preventDefault();
      event.stopPropagation();
      cancel.click();
      row.focus();
    }
    return;
  }
  if (event.target !== row) {
    return;
  }

  const rows = [...el("cookie-rows").rows];
  const index = rows.indexOf(row);
  const moveTo = (to) => rows[Math.max(0, Math.min(rows.length - 1, to))].focus();

  if (event.key === "ArrowDown") {
    moveTo(index + 1);
  } else if (event.key === "ArrowUp") {
    if (index === 0) {
      el("search-input").focus();
    } else {
      moveTo(index - 1);
    }
  } else if (event.key === "Home") {
    moveTo(0);
  } else if (event.key === "End") {
    moveTo(rows.length - 1);
  } else if (event.key === "Enter") {
    const cookie = cookieForRow(row);
    if (cookie) {
      openEditor(cookie);
    }
  } else if (event.key === " ") {
    row.querySelector("td.pick input").click();
  } else if (event.key === "k" || event.key === "K") {
    row.querySelector("button.row-button.keep").click();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    const remove = row.querySelector("button.row-button.danger");
    if (remove.disabled) {
      const cookie = cookieForRow(row);
      showMainMessage(
        (cookie ? cookie.name : "This cookie") +
          " is being kept, so it can't be deleted. Press K to stop keeping it.",
        true
      );
    } else {
      remove.click();
      remove.focus();
    }
  } else {
    return;
  }
  event.preventDefault();
}

// --- following the site's changes ------------------------------------------

// The table follows changes as they happen: the site setting a cookie on
// login, say. Changes come in bursts, so they're gathered up and the table
// is drawn again at most once a second.
let liveTimer = null;
let livePending = false;
let lastLiveDraw = 0;

// The same cookies getCookiesForPage() reads: this host, its parent
// domains and its subdomains.
function concernsPage(cookie) {
  if (!page) {
    return false;
  }
  const domain = String(cookie.domain || "").replace(/^\./, "");
  const host = page.hostname;
  return domain === host || host.endsWith("." + domain) || domain.endsWith("." + host);
}

// Never pulls the rug: the table isn't redrawn while another screen is open,
// while "Delete these cookies?" is showing, or while a row says "Sure?".
// It's redrawn as soon as none of those is true.
function liveRedrawWaits() {
  return (
    currentState() !== "main" ||
    !el("confirm-row").hidden ||
    el("cookie-rows").querySelector(".armed") !== null
  );
}

function scheduleLiveRedraw() {
  if (liveTimer !== null) {
    return;
  }
  const wait = Math.max(300, 1000 - (Date.now() - lastLiveDraw));
  liveTimer = setTimeout(runLiveRedraw, wait);
}

async function runLiveRedraw() {
  liveTimer = null;
  if (!livePending) {
    return;
  }
  if (liveRedrawWaits()) {
    liveTimer = setTimeout(runLiveRedraw, 1000);
    return;
  }
  livePending = false;
  lastLiveDraw = Date.now();
  await refresh();
  announceChanges();
}

// "1 cookie added, 2 changed." for screen readers.
function announceChanges() {
  const parts = [
    [lastChange.added, "added"],
    [lastChange.changed, "changed"],
    [lastChange.removed, "removed"],
  ].filter(([count]) => count > 0);
  if (parts.length === 0) {
    return;
  }
  el("live-note").textContent =
    parts
      .map(([count, what], i) => (i === 0 ? pluralise(count, "cookie", "cookies") : formatCount(count)) + " " + what)
      .join(", ") + ".";
}

function sameCookie(a, b) {
  return cookieKey(a) === cookieKey(b);
}

// Chrome's reason for a change, in plain words. `removed` is false when a
// cookie was set, and true when one went away.
function describeCookieEvent(key, removed, cause) {
  if (!removed) {
    return overwritten.delete(key) ? "Changed" : "Added";
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
function logChange(cookie, removed, cause) {
  const key = cookieKey(cookie);
  if (removed && cause === "overwrite") {
    overwritten.add(key);
    return false;
  }

  changeLog.unshift({
    at: Date.now(),
    name: cookie.name,
    domain: String(cookie.domain || "").replace(/^\./, ""),
    what: describeCookieEvent(key, removed, cause),
  });
  changeLog.length = Math.min(changeLog.length, CHANGE_LOG_LIMIT);
  return true;
}

// "3 changes" next to the cookie count, once there's something to list.
function showChangesLink() {
  el("changes-link").hidden = changeLog.length === 0;
  el("changes-open").textContent = pluralise(changeLog.length, "change", "changes");
}

function drawChanges() {
  const rows = el("changes-rows");
  rows.textContent = "";

  for (const change of changeLog) {
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

function openChanges() {
  drawChanges();
  showState("changes");
  el("changes-back").focus();
}

function closeChanges() {
  el("changes-rows").textContent = "";
  showState("main");
  el("changes-open").focus();
}

chrome.cookies.onChanged.addListener(({ cookie, removed, cause }) => {
  // The editor says so if the cookie open in it changes underneath it.
  if (currentState() === "edit" && editing && !saving && sameCookie(cookie, editing)) {
    el("edit-changed").hidden = false;
  }
  if (concernsPage(cookie)) {
    if (logChange(cookie, removed, cause)) {
      showChangesLink();
      // The list keeps up if it's the screen showing.
      if (currentState() === "changes") {
        drawChanges();
      }
    }
    livePending = true;
    scheduleLiveRedraw();
  }
});

// --- ticking cookies -------------------------------------------------------

// The cookies on this page that are ticked, hidden by a search or not.
function pickedCookies() {
  return pageCookies.filter((cookie) => picked.has(cookieKey(cookie)));
}

// Ticking doesn't redraw the table, so focus stays on the box just ticked.
function pickCookie(cookie, ticked) {
  const before = picked.size;
  if (ticked) {
    picked.add(cookieKey(cookie));
  } else {
    picked.delete(cookieKey(cookie));
  }
  scopeAfterPicking(before);
}

// The tick box in the header ticks or unticks every cookie shown.
function pickAllShown(ticked) {
  const before = picked.size;
  for (const cookie of shownCookies) {
    if (ticked) {
      picked.add(cookieKey(cookie));
    } else {
      picked.delete(cookieKey(cookie));
    }
  }
  for (const box of document.querySelectorAll("#cookie-rows td.pick input")) {
    box.checked = ticked;
  }
  scopeAfterPicking(before);
}

// The first tick switches the delete panel to the ticked cookies, which is
// always a smaller set than the scope it replaces. Unticking the last one
// goes back to "This page".
function scopeAfterPicking(before) {
  showPicked();
  if (before === 0 && picked.size > 0) {
    document.querySelector('input[name="scope"][value="picked"]').checked = true;
  }
  refreshScope();
}

// The header tick box and the "Just the ticked cookies" option.
function showPicked() {
  const shownPicked = shownCookies.filter((cookie) => picked.has(cookieKey(cookie))).length;
  const all = el("pick-all");
  all.checked = shownCookies.length > 0 && shownPicked === shownCookies.length;
  all.indeterminate = shownPicked > 0 && shownPicked < shownCookies.length;
  all.disabled = shownCookies.length === 0;

  const count = pickedCookies().length;
  el("scope-picked-row").hidden = count === 0;
  el("scope-target-picked").textContent = count > 0 ? pluralise(count, "cookie", "cookies") : "";
  if (count === 0 && selectedScope() === "picked") {
    document.querySelector('input[name="scope"][value="page"]').checked = true;
  }
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
    // "matches" and "picked" delete exactly the rows chosen in the table, so
    // they use the table's own list rather than asking Chrome again.
    if (selectedScope() === "matches") {
      inScope = shownCookies;
    } else if (selectedScope() === "picked") {
      inScope = pickedCookies();
    } else {
      inScope = await getCookiesForScope(selectedScope(), page);
    }
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

  const count = scopeCookies.length;
  const sites = sitesOf(scopeCookies);
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
    "Will delete " + pluralise(count, "cookie", "cookies") + describeSites(sites) + "." + keptNote;

  // List every site, so the user sees exactly what will go first.
  if (sites.length > 1) {
    const list = el("scope-domains-list");
    list.textContent = "";
    for (const site of sites) {
      const item = document.createElement("li");
      item.textContent = site; // comes from websites, so never innerHTML
      list.appendChild(item);
    }
    el("scope-domains-summary").textContent =
      "Show the " + formatCount(sites.length) + " sites affected";
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

// " from example.com" for one site, " across 3 sites" for more.
function describeSites(sites) {
  return sites.length === 1 ? " from " + sites[0] : " across " + pluralise(sites.length, "site", "sites");
}

function startConfirm() {
  el("confirm-text").textContent =
    "Delete " + pluralise(scopeCookies.length, "cookie", "cookies") + describeSites(sitesOf(scopeCookies)) + "?";

  el("main-message").hidden = true;
  el("delete-button").hidden = true;
  el("export-button").hidden = true;
  el("confirm-row").hidden = false;
  el("confirm-yes").focus();
}

// The result goes in the status line under the header, like every other
// result, with Undo next to it.
async function runDelete() {
  const result = el("main-message");
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
    await offerUndo(result, { kind: "delete", restore: removedCookies });
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
  el("edit-changed").hidden = true;

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

  // A partitioned cookie can't be made here, so it can't be duplicated.
  el("edit-duplicate").hidden = isNew || Boolean(cookie.partitionKey);

  showDecoded();
  showValueSize();
  showState("edit");
  el("field-name").focus();
}

// Says how big the cookie is once it's close to Chrome's limit, and turns
// red once it's over. Updated as the name or value is typed.
function showValueSize() {
  const bytes = cookieBytes({ name: el("field-name").value, value: el("field-value").value });
  const note = el("value-size");
  note.hidden = bytes < LARGE_COOKIE_BYTES;
  note.textContent =
    bytes.toLocaleString("en-GB") + " of " + MAX_COOKIE_BYTES.toLocaleString("en-GB") +
    " bytes (name and value together).";
  note.className = bytes > MAX_COOKIE_BYTES ? "field-note error" : "field-note muted";
}

// The expiry shortcuts. Each sets the date that many seconds from now.
function expireIn(seconds) {
  el("field-session").checked = false;
  syncExpiryEnabled();
  el("field-expiry").value = toLocalDateTimeValue(Date.now() / 1000 + seconds);
}

// Turns the editor into a new cookie with the details already filled in,
// including anything typed since it was opened. The cookie being edited is
// left alone. Saving goes the usual way, so Undo works on it.
function duplicateCookie() {
  editing = null;
  el("edit-title").textContent = "New cookie";
  el("edit-duplicate").hidden = true;
  el("edit-changed").hidden = true;
  showFormErrors([]);

  const name = el("field-name");
  name.value = name.value.trim() + "_copy";
  showValueSize();
  name.focus();
  name.select();
}

// Shows the value URL-decoded or laid out as JSON, when that's easier to
// read. Updated as the value is typed. See decodeValue() in format.js.
function showDecoded() {
  const decoded = decodeValue(el("field-value").value);
  el("value-decoded").hidden = decoded === null;
  el("value-decoded-text").textContent = decoded === null ? "" : decoded;
}

// Focus goes back to the cookie's row, for anyone using the keyboard.
function closeEditor() {
  const key = editing ? cookieKey(editing) : null;
  editing = null;
  showState("main");
  const row = key ? [...el("cookie-rows").rows].find((r) => r.dataset.key === key) : null;
  if (row) {
    row.focus();
  }
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
    saving = true;
    const { ok, cookie, error } = await writeCookie(editing, values);
    saving = false;

    if (!ok) {
      showFormErrors([error]);
      return;
    }

    // What Undo needs. An edit puts the old cookie back. If the name, domain
    // or path changed, the saved cookie is a second cookie, so Undo takes
    // it away too. A new cookie is only taken away.
    const original = editing;
    const change = original
      ? {
          kind: "edit",
          restore: [original],
          remove: cookieKey(original) === cookieKey(cookie) ? [] : [cookie],
        }
      : { kind: "create", remove: [cookie] };

    closeEditor();
    showMainMessage(
      (original ? "Saved changes to " + values.name + "." : "Created " + values.name + ".") +
        describeExpiryChange(values, cookie),
      false
    );
    await offerUndo(el("main-message"), change);
    await refresh();
  } catch (error) {
    // Shouldn't happen, since writeCookie() catches its own errors. Show it
    // anyway so the form doesn't look stuck.
    showFormErrors([error && error.message ? error.message : String(error)]);
  } finally {
    saving = false;
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

// --- the list of kept cookies ----------------------------------------------

// "Kept cookies: 3" in the delete panel. It counts the whole saved list, not
// just this site's, so the list can be reached from any site.
function showKeptLink() {
  const link = el("kept-open");
  link.hidden = protectedKeys.size === 0;
  link.textContent = "Kept cookies: " + formatCount(protectedKeys.size);
}

async function openKept() {
  el("kept-message").hidden = true;
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
  message.hidden = false;
}

async function stopKeeping(entries, described) {
  const { keys, error } = await unprotectKeys(entries.map((entry) => entry.key));
  protectedKeys = keys;
  cancelKeptConfirm();
  await drawKept();
  if (error) {
    showKeptMessage(error, true);
  } else {
    showKeptMessage("No longer keeping " + described + ".", false);
  }
}

// "Stop keeping all" asks first, like the delete panel.
async function startKeptConfirm() {
  const { entries } = await listProtected();
  el("kept-confirm-text").textContent =
    "Stop keeping " + (entries.length === 1 ? "this cookie" : "all " + formatCount(entries.length) + " cookies") + "?";
  el("kept-clear").hidden = true;
  el("kept-confirm").hidden = false;
  el("kept-confirm-no").focus();
}

function cancelKeptConfirm() {
  el("kept-confirm").hidden = true;
  el("kept-clear").hidden = false;
}

async function stopKeepingAll() {
  const { entries } = await listProtected();
  await stopKeeping(entries, pluralise(entries.length, "cookie", "cookies"));
}

// Back to the table, redrawn, since what's kept may have changed.
async function closeKept() {
  el("kept-rows").textContent = "";
  showState("main");
  drawTable();
  await refreshScope();
  if (!el("kept-open").hidden) {
    el("kept-open").focus();
  }
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
    await offerUndo(el("main-message"), { kind: "delete", restore: [cookie] });
  }

  await refresh();
}

// --- undo ------------------------------------------------------------------

// Remembers a change and adds an Undo button to its message. Setting the
// message's text later removes the button. That's fine: the change can
// still be undone from the next open, for up to 10 minutes.
async function offerUndo(message, change) {
  if ((change.restore || []).length + (change.remove || []).length === 0) {
    return;
  }
  const { error } = await saveLastChange(change);
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

// "Deleted 5 cookies from example.com", "Imported 12 cookies across 3
// sites", "Saved changes to sid", "Created theme".
function describeChange(change) {
  if (change.kind === "edit") {
    return "Saved changes to " + change.restore[0].name;
  }
  if (change.kind === "create") {
    return "Created " + change.remove[0].name;
  }

  const affected = [...change.restore, ...change.remove];
  const what =
    affected.length === 1 ? affected[0].name : pluralise(affected.length, "cookie", "cookies");
  const where = describeSites(sitesOf(affected));
  return (change.kind === "import" ? "Imported " : "Deleted ") + what + where;
}

// On opening, offer to undo a change made in the last 10 minutes, unless
// something more important is already showing.
async function offerStoredUndo() {
  const last = await loadLastChange();
  if (!last || !el("main-message").hidden) {
    return;
  }
  showMainMessage(
    describeChange(last) + " " + describeAge(Date.now() / 1000 - last.at) + ".",
    false
  );
  appendUndoButton(el("main-message"));
}

// What Undo did, in words. A delete says "Restored 5 cookies." An edit says
// "Put sid back as it was." An import says "Removed 9 cookies and put back 3
// cookies."
function describeUndone(change, result) {
  const { removed, restored, failures } = result;
  if (change.kind === "delete") {
    return "Restored " + pluralise(restored, "cookie", "cookies") + ".";
  }
  if (change.kind === "edit" && restored === 1 && failures.length === 0) {
    return "Put " + change.restore[0].name + " back as it was.";
  }
  if (change.kind === "create" && removed === 1) {
    return "Removed " + change.remove[0].name + ".";
  }

  const done = [];
  if (removed > 0) {
    done.push("removed " + pluralise(removed, "cookie", "cookies"));
  }
  if (restored > 0) {
    done.push("put back " + pluralise(restored, "cookie", "cookies"));
  }
  if (done.length === 0) {
    return "Nothing was changed.";
  }
  const sentence = done.join(" and ") + ".";
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

async function runUndo(message, button) {
  button.disabled = true;

  const last = await loadLastChange();
  if (!last) {
    message.className = "result error";
    message.textContent = "There's nothing to undo. Undo only lasts 10 minutes after a change.";
    return;
  }

  message.className = "result";
  message.textContent = "Undoing…";

  // Read the Kept list fresh, so Undo never removes a cookie kept since.
  const { keys } = await loadProtected();
  const result = await undoChange(last, (cookie) => isProtected(keys, cookie));
  await clearLastChange();

  const parts = [describeUndone(last, result)];
  if (result.kept > 0) {
    parts.push(
      pluralise(result.kept, "cookie is", "cookies are") +
        " marked Kept, so " +
        (result.kept === 1 ? "it was" : "they were") +
        " left alone."
    );
  }
  if (result.expired > 0) {
    parts.push(
      pluralise(result.expired, "cookie has", "cookies have") +
        " expired since, so " +
        (result.expired === 1 ? "it wasn't" : "they weren't") +
        " put back."
    );
  }
  if (result.failures.length > 0) {
    parts.push(
      "Chrome refused " +
        pluralise(result.failures.length, "cookie", "cookies") +
        ": " +
        result.failures.join(" ")
    );
  }
  message.className = result.failures.length > 0 ? "result error" : "result";
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
    picked: page.hostname + "-ticked",
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
  const sites = sitesOf(scopeAll);
  const kept = scopeAll.length - scopeCookies.length;

  el("export-summary").textContent =
    pluralise(scopeAll.length, "cookie", "cookies") +
    describeSites(sites) +
    (kept > 0 ? ", including " + pluralise(kept, "kept cookie", "kept cookies") : "") +
    ".";

  // The Cookie header and curl both send cookies to one page, so they're
  // only offered when the cookies are one page's.
  const onePage = exportIsOnePage(sites);
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
function exportIsOnePage(sites) {
  return (
    selectedScope() === "page" ||
    selectedScope() === "matches" ||
    selectedScope() === "picked" ||
    sites.length <= 1
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
  el("import-move").checked = false;
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

  const pageUrl = page.origin + "/";
  const parsed = parseImport(el("import-text").value, { pageUrl });
  let entries = parsed.entries;
  let problems = parsed.problems;

  // Cookies from another site can be put on this one instead, such as from
  // a staging site to localhost. Only offered when some are from elsewhere.
  const elsewhere = entries.some((entry) => !isForSite(entry, page.hostname));
  el("import-move-site").textContent = page.hostname;
  el("import-move-row").hidden = !elsewhere;
  if (elsewhere && el("import-move").checked) {
    const moved = moveToSite(entries, pageUrl);
    entries = moved.entries;
    problems = [...problems, ...moved.problems];
  }

  let existing;
  try {
    existing = await getAllCookies();
  } catch (error) {
    showImportResult("Couldn't read your current cookies to compare: " + error.message, true);
    return;
  }

  // A Cookie header or curl command only has names and values. The rest
  // comes from the cookies the site already has.
  entries = matchSentCookies(entries, existing);
  const fromHeader = parsed.format === "header" || parsed.format === "curl";

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
          " you already have." +
          (fromHeader ? (replacing === 1 ? " Only its value changes." : " Only their values change.") : "")
      );
    }
    const adding = count - replacing;
    if (fromHeader && adding > 0) {
      parts.push(
        pluralise(adding, "new cookie", "new cookies") +
          (adding === 1
            ? " will be a session cookie, so Chrome removes it when it closes."
            : " will be session cookies, so Chrome removes them when it closes.")
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
  // For Undo: the cookies this import replaced, and the ones it added.
  const change = { kind: "import", restore: [], remove: [] };

  // One at a time, so the result for each cookie is known.
  for (const { entry, replaces, match } of plan.toWrite) {
    const { ok, cookie, error } = await writeCookie(null, entry);
    if (!ok) {
      failures.push(entry.name + " (" + entry.domain + "): " + error);
      continue;
    }
    if (replaces) {
      replaced += 1;
      change.restore.push(match);
    } else {
      created += 1;
      change.remove.push(cookie);
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
  await offerUndo(el("import-result"), change);
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

// Back on the main screen, an import made just now can be undone from the
// status line, like any other change.
async function closeImport() {
  showState("main");
  await refresh();
  await offerStoredUndo();
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

for (const chip of document.querySelectorAll("#filters .chip")) {
  chip.addEventListener("click", () => toggleFilter(chip.dataset.filter));
}

el("search-clear").addEventListener("click", () => {
  el("search-input").value = "";
  activeFilters = new Set();
  drawTable();
  refreshScope();
  el("search-input").focus();
});

el("changes-open").addEventListener("click", openChanges);
el("changes-back").addEventListener("click", closeChanges);
el("kept-open").addEventListener("click", openKept);
el("kept-back").addEventListener("click", closeKept);
el("kept-clear").addEventListener("click", startKeptConfirm);
el("kept-confirm-yes").addEventListener("click", stopKeepingAll);
el("kept-confirm-no").addEventListener("click", () => {
  cancelKeptConfirm();
  el("kept-clear").focus();
});

el("pick-all").addEventListener("change", () => pickAllShown(el("pick-all").checked));
el("cookie-rows").addEventListener("keydown", onTableKey);
el("cookie-rows").addEventListener("focusin", (event) => {
  const row = event.target.closest("tr");
  if (row && row.dataset.key !== tabRowKey) {
    setTabRow(row.dataset.key);
  }
});
// Down from the search box goes into the table.
el("search-input").addEventListener("keydown", (event) => {
  const first = el("cookie-rows").rows[0];
  if (event.key === "ArrowDown" && first && !el("cookie-table").hidden) {
    event.preventDefault();
    first.focus();
  }
});
for (const button of document.querySelectorAll("th button.sort")) {
  button.addEventListener("click", () => sortBy(button.dataset.sort));
}

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
  radio.addEventListener("change", refreshScope);
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
el("import-text").addEventListener("input", () => {
  el("import-move").checked = false;
  resetImportPreview();
});
// Ticking "Put them on this site instead" checks again with the cookies
// moved, and leaves focus on the box.
el("import-move").addEventListener("change", async () => {
  await checkImport();
  el("import-move").focus();
});

el("value-copy").addEventListener("click", () =>
  copyWithFeedback(el("value-copy"), el("field-value").value)
);
el("field-value").addEventListener("input", showDecoded);
el("field-value").addEventListener("input", showValueSize);
el("field-name").addEventListener("input", showValueSize);
el("edit-duplicate").addEventListener("click", duplicateCookie);
for (const button of document.querySelectorAll("[data-expire-in]")) {
  button.addEventListener("click", () => expireIn(Number(button.dataset.expireIn)));
}
el("decoded-copy").addEventListener("click", () =>
  copyWithFeedback(el("decoded-copy"), el("value-decoded-text").textContent)
);

el("help-button").addEventListener("click", () => {
  el("main-message").hidden = true;
  showState("help");
  el("help-back").focus();
});
el("help-back").addEventListener("click", () => showState("main"));

// --- keyboard --------------------------------------------------------------

// The screen showing now, such as "main" or "edit".
function currentState() {
  const shown = document.querySelector(".state:not([hidden])");
  return shown ? shown.id.replace(/^state-/, "") : "";
}

// Each screen's way back, for Esc.
const BACK_BUTTONS = {
  kept: "kept-back",
  changes: "changes-back",
  edit: "edit-cancel",
  export: "export-back",
  import: "import-back",
  help: "help-back",
};

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  // Esc goes back from a screen, or backs out of "Delete these cookies?",
  // instead of closing the popup. Whether Chrome lets a toolbar popup keep
  // Esc for itself is checked by hand (see docs/NOTES.md in the private
  // repo). In a tab it always works.
  if (event.key === "Escape") {
    const back = BACK_BUTTONS[currentState()];
    if (back) {
      event.preventDefault();
      el(back).click();
    } else if (currentState() === "main" && !el("confirm-row").hidden) {
      event.preventDefault();
      cancelConfirm();
      el("delete-button").focus();
    }
    return;
  }

  // "/" jumps to the search box, unless you're typing somewhere already.
  if (event.key === "/" && currentState() === "main") {
    const typing = event.target.closest("input, textarea, select");
    if (!typing) {
      event.preventDefault();
      el("search-input").focus();
    }
  }
});
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
