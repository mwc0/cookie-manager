// Runs the popup: picks which screen to show, loads the cookies and draws
// the table, and handles ticking, keeping and deleting them. The other
// screens each have a file of their own: editor.js, rules-screen.js,
// export-screen.js, import-screen.js and small-screens.js.

import {
  hasHostAccess,
  requestHostAccess,
  requestPermission,
  PANEL_PERMISSION,
} from "../lib/permissions.js";
import { BLOCK } from "../lib/rules.js";
import {
  getSiteCookies,
  setByOtherSite,
  getCookiesForScope,
  removeCookie,
  removeCookies,
  writeCookie,
  filterCookies,
  filterByFlags,
  passesFilter,
  baseHostOf,
  cookieKey,
  sitesOf,
} from "../lib/cookies.js";
import { copyWithFeedback } from "./clipboard.js";
import {
  loadProtected,
  setProtected,
  isProtected,
  partitionByProtection,
  pruneProtected,
  unprotectKeys,
  protectCookies,
  protectionKeyOf,
} from "../lib/protect.js";
import {
  pluralise,
  formatCount,
  headerBytes,
  formatBytes,
  describeError,
  bareDomain,
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
import { recordAnswer } from "../lib/review.js";
import { loadKnownCookies } from "../lib/known.js";
import { valuesOf } from "../lib/undo.js";
import { state } from "./state.js";
import {
  el,
  targetTabId,
  inTab,
  inPanel,
  showState,
  showError,
  showBlocked,
  showMainMessage,
  describeSites,
  currentState,
} from "./ui.js";
import {
  openEditor,
  showKnownName,
  showValueSize,
  expireIn,
  duplicateCookie,
  showDecoded,
  valueToSave,
  showJsonChoice,
  toggleJson,
  copySetCookie,
  closeEditor,
  syncExpiryEnabled,
  saveEditor,
} from "./editor.js";
import {
  pageRule,
  loadSiteRules,
  showRulesLink,
  openRules,
  onRadioChoice,
  focusChecked,
  grantRules,
  chooseSiteRule,
  hideCleanup,
  runCleanup,
  toggleDeleteOnBlock,
  toggleTrackers,
  askEverywhere,
  chooseEverywhere,
  startSiteDataClear,
  cancelSiteDataClear,
  runSiteDataClear,
  saveRulesBackup,
  readRulesBackup,
  cancelLoad,
  loadRulesBackup,
  startRulesConfirm,
  cancelRulesConfirm,
  clearAllRules,
  closeRules,
} from "./rules-screen.js";
import {
  showKeptLink,
  openKept,
  startKeptConfirm,
  cancelKeptConfirm,
  stopKeepingAll,
  closeKept,
  logChange,
  showChangesLink,
  drawChanges,
  openChanges,
  closeChanges,
  showWhatsNew,
  openReviewPage,
} from "./small-screens.js";
import { openReport, closeReport } from "./report-screen.js";
import { offerUndo, appendReloadButton, offerStoredUndo } from "./undo-button.js";
import {
  copyExport,
  closeExport,
  openExport,
  showExportText,
  downloadExport,
} from "./export-screen.js";
import {
  forgetImportPassword,
  openImport,
  resetImportPreview,
  checkImport,
  compareImport,
  closeCompare,
  runImport,
  readImportFile,
  closeImport,
} from "./import-screen.js";

// Long values opened in the table, by cookie key, so they stay open when the
// table is drawn again.
let expanded = new Set();

// For marking rows the site has just added or changed: each cookie's key and
// what it looked like at the last load, then what's different this time.
// See refreshTable().
let seenCookies = null;
let changedKeys = new Set();
let lastChange = { added: 0, changed: 0, removed: 0 };

// The row that's in the tab order. See setTabRow().
let tabRowKey = null;

// All of this page's cookies, and the ones the search is showing.
// "Just the cookies shown" deletes shownCookies, the same list as the table.
let pageCookies = [];
let shownCookies = [];

// How the table is sorted. Kept in memory only, so every open starts with
// the default.
let sort = DEFAULT_SORT;

// The cookies ticked in the table, as cookieKey()s. "Just the ticked
// cookies" deletes and exports exactly these. Kept in memory only.
let picked = new Set();

// The quick filters that are switched on, by name ("secure", "kept"...).
// Kept in memory only, so every open starts with none.
let activeFilters = new Set();

// Above this, the popup warns that the site's cookies are getting too big.
const SIZE_WARNING_BYTES = 6 * 1024;

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

// The tab whose cookies are shown: the active tab in the popup and the side
// panel, or the tab it was opened from when it's open in a tab of its own.
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
  if (!state.page || state.page.hostname !== url.hostname) {
    state.changeLog = [];
    state.overwritten = new Set();
  }

  // A message about the last page goes. Not on the first load, though:
  // initTheme() runs alongside this, and an error it has already shown
  // would be wiped.
  if (state.page) {
    el("main-message").textContent = "";
  }

  state.page = { origin: url.origin, hostname: url.hostname, tabId: tab.id };
  seenCookies = null;
  expanded = new Set();

  el("site-name").textContent = url.hostname;
  if (inTab) {
    document.title = "cookieZ - " + url.hostname;
  }
  el("scope-target-page").textContent = url.hostname;
  el("scope-target-domain").textContent = baseHostOf(url.hostname);

  showState("main");
  // The table first, so it shows as soon as it can. The rules only change
  // the Block button, and what the table says when it's empty, so those are
  // put right once the rules are in.
  await refresh();
  await loadSiteRules();
  showRulesLink();
  if (pageCookies.length === 0) {
    drawTable();
  }
  await showWhatsNew();
  await offerStoredUndo();
  showKnownWhenLoaded();
}

// The list of known cookie names loads after the table is showing, so it
// doesn't slow opening (see src/lib/known.js). Once it's in, the table is
// drawn again with its Known badges. If now isn't a good moment, such as
// while a row says "Sure?", that waits, as it does when the site changes a
// cookie.
let knownReady = false;

async function showKnownWhenLoaded() {
  if (knownReady) {
    return;
  }
  knownReady = await loadKnownCookies();
  if (!knownReady) {
    return;
  }
  if (currentState() === "edit") {
    showKnownName();
  }
  if (liveRedrawWaits()) {
    livePending = true;
    scheduleLiveRedraw();
  } else {
    drawTable();
  }
}

// Reloads the table, then the delete count. These must run one after the
// other. refreshScope() uses the Kept list that refreshTable() loads, and
// running them together once let a delete remove a cookie shown as kept.
export async function refresh() {
  await refreshTable();
  await refreshScope();
}

async function refreshTable() {
  try {
    pageCookies = await getSiteCookies(state.page);
    noteChanges(pageCookies);

    const { keys, error } = await loadProtected();
    state.protectedKeys = keys;
    if (error) {
      // Must be shown: a cookie the user thinks is kept could get deleted.
      showMainMessage(error, true);
    }

    // Forget Kept entries for cookies that are gone. See pruneProtected().
    // Only this site's own domains: the table only has the cookies other
    // companies keep for this site, not the rest of theirs, so their kept
    // cookies elsewhere would look gone.
    const domains = new Set(
      pageCookies
        .filter((c) => !setByOtherSite(c, state.page.hostname))
        .map((c) => bareDomain(c.domain))
    );
    domains.add(state.page.hostname);
    const pruned = await pruneProtected(state.protectedKeys, pageCookies, domains);
    state.protectedKeys = pruned.keys;

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
export function drawTable() {
  const query = el("search-input").value;
  const isKept = (cookie) => isProtected(state.protectedKeys, cookie);
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
    isProtected: (cookie) => isProtected(state.protectedKeys, cookie),
    onPick: pickCookie,
    isPicked: (cookie) => picked.has(cookieKey(cookie)),
    isChanged: (cookie) => changed.has(cookieKey(cookie)),
    isExpanded: (cookie) => expanded.has(cookieKey(cookie)),
    isEmbedded: (cookie) => setByOtherSite(cookie, state.page.hostname),
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
  showRulesLink();

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
  // which a browser only sends on those paths. Cookies other companies keep
  // for this site are left out: they're only sent to those companies.
  const bytes = headerBytes(pageCookies.filter((cookie) => !setByOtherSite(cookie, state.page.hostname)));
  el("cookie-count").textContent =
    (filtering
      ? pluralise(shownCookies.length, "cookie", "cookies") +
        " of " + pluralise(pageCookies.length, "cookie", "cookies")
      : pluralise(pageCookies.length, "cookie", "cookies")) +
    (bytes > 0 ? " · about " + formatBytes(bytes) : "");

  // Many servers refuse requests with more than 8 KB of headers, and a site
  // that has piled up cookies is a common reason someone can't log in.
  // A live region, so it's emptied rather than hidden (see popup.html). The
  // text is only set when it changes, so a redraw doesn't read it again.
  const warning = el("size-warning");
  const warningText = bytes <= SIZE_WARNING_BYTES
    ? ""
    : "This site's cookies add up to about " +
      formatBytes(bytes) +
      ". Many servers refuse more than 8 KB, which can stop you logging in. " +
      "Deleting this site's cookies usually fixes it.";
  if (warning.textContent !== warningText) {
    warning.textContent = warningText;
  }

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
    ? pageRule() === BLOCK
      ? "No cookies are set for this site. Your site rules are blocking them."
      : "No cookies are set for this site."
    : query.trim() === ""
      ? "No cookies here match those filters."
      : activeFilters.size > 0
        ? "No cookies here match “" + query.trim() + "” and those filters."
        : "No cookies here match “" + query.trim() + "”.";
  el("empty-message").hidden = !(nothingAtAll || nothingMatched);
  el("cookie-table").hidden = nothingAtAll || nothingMatched;
}

// The quick filters. One that no cookie on this site matches is hidden,
// unless it's switched on, so it can always be switched off again. "Not
// Secure" is only offered on an HTTPS page: on a plain HTTP page no cookie
// set there is Secure, so it would say nothing.
function drawFilters(isKept) {
  let anyShown = false;
  const https = state.page.origin.startsWith("https:");
  for (const chip of document.querySelectorAll("#filters .chip")) {
    const name = chip.dataset.filter;
    const on = activeFilters.has(name);
    const matches =
      (name !== "notsecure" || https) &&
      pageCookies.some((cookie) => passesFilter(cookie, name, isKept));
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

// The same cookies getSiteCookies() reads: this host, its parent domains
// and its subdomains, and the partitioned cookies kept for this site by
// others. A partition is named after a site (example.com), which is this
// host or one of its parent domains.
function concernsPage(cookie) {
  if (!state.page) {
    return false;
  }
  const domain = bareDomain(cookie.domain);
  const host = state.page.hostname;
  if (domain === host || host.endsWith("." + domain) || domain.endsWith("." + host)) {
    return true;
  }
  const site = cookie.partitionKey ? String(cookie.partitionKey.topLevelSite || "") : "";
  const siteHost = site.replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
  return siteHost !== "" && (siteHost === host || host.endsWith("." + siteHost));
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

chrome.cookies.onChanged.addListener(({ cookie, removed, cause }) => {
  // The editor says so if the cookie open in it changes underneath it.
  if (currentState() === "edit" && state.editing && !state.saving && sameCookie(cookie, state.editing)) {
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
  el("picked-bar").hidden = count === 0;
  el("picked-count").textContent = pluralise(count, "cookie", "cookies") + " ticked:";
  el("scope-picked-row").hidden = count === 0;
  el("scope-target-picked").textContent = count > 0 ? pluralise(count, "cookie", "cookies") : "";
  if (count === 0 && selectedScope() === "picked") {
    document.querySelector('input[name="scope"][value="page"]').checked = true;
  }
}

// --- delete scope ----------------------------------------------------------

export function selectedScope() {
  const checked = document.querySelector('input[name="scope"]:checked');
  return checked ? checked.value : "page";
}

export async function refreshScope() {
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
    } else if (selectedScope() === "page") {
      // "This page" is the table's own list too: refreshTable() has just
      // read it with the same query (getSiteCookies() is
      // getCookiesForScope("page", page, { embedded: true })), so asking
      // Chrome again would only slow opening.
      inScope = pageCookies;
    } else {
      // The cookies other companies keep for this site are in the table,
      // so they're in this site's scopes too.
      inScope = await getCookiesForScope(selectedScope(), state.page, { embedded: true });
    }
  } catch (error) {
    state.scopeCookies = [];
    state.scopeAll = [];
    summaryLine.textContent = "Couldn't count the cookies in this scope: " + describeError(error);
    return;
  }

  state.scopeAll = inScope;
  el("export-button").disabled = inScope.length === 0;

  // Kept cookies are taken out before counting, so the number shown is still
  // exactly what will be deleted.
  const { deletable, kept } = partitionByProtection(state.protectedKeys, inScope);
  state.scopeCookies = deletable;

  const count = state.scopeCookies.length;
  const sites = sitesOf(state.scopeCookies);
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

// Also backs out of "Clear site data", whose count would be out of date too.
export function cancelConfirm() {
  el("confirm-row").hidden = true;
  el("data-confirm").hidden = true;
  state.siteDataCookies = [];
  el("delete-button").hidden = false;
  el("export-button").hidden = false;
  el("data-button").hidden = false;
}

function startConfirm() {
  el("confirm-text").textContent =
    "Delete " + pluralise(state.scopeCookies.length, "cookie", "cookies") + describeSites(sitesOf(state.scopeCookies)) + "?";

  el("main-message").textContent = "";
  el("delete-button").hidden = true;
  el("export-button").hidden = true;
  el("data-button").hidden = true;
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
  result.className = "result";
  result.textContent = "Deleting…";

  try {
    const { removed, removedCookies, failed } = await removeCookies(state.scopeCookies);

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
    if (removedCookies.length > 0) {
      appendReloadButton(result);
    }
  } catch (error) {
    result.className = "result error";
    result.textContent = "The delete failed: " + describeError(error);
  } finally {
    yes.disabled = false;
    no.disabled = false;
    cancelConfirm();
    await refresh();
    // "Yes, delete" has gone, which would leave the focus nowhere. Undo is
    // the likeliest next step; without one, back to Delete, or to the
    // search box if there's nothing left to delete.
    const undo = result.querySelector(".undo-button");
    const remove = el("delete-button");
    (undo || (remove.disabled ? el("search-input") : remove)).focus();
  }
}

// Deletes one cookie from its row. The row already asked "Sure?".
async function deleteOne(cookie) {
  // The button is disabled for kept cookies, but check again in case the
  // table is out of date.
  if (isProtected(state.protectedKeys, cookie)) {
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

// --- keeping cookies -------------------------------------------------------

async function toggleProtected(cookie, shouldKeep) {
  const { keys, error } = await setProtected(cookie, shouldKeep);
  state.protectedKeys = keys;

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

// --- things to do to every ticked cookie ----------------------------------

async function keepPicked(shouldKeep) {
  const cookies = pickedCookies();
  const { keys, error } = shouldKeep
    ? await protectCookies(cookies)
    : await unprotectKeys(cookies.map(protectionKeyOf));
  state.protectedKeys = keys;
  if (error) {
    showMainMessage(error, true);
    return;
  }
  showMainMessage(
    (shouldKeep ? "Keeping " : "No longer keeping ") + pluralise(cookies.length, "cookie", "cookies") + ".",
    false
  );
  drawTable();
  await refreshScope();
}

// Sets every ticked cookie to expire `seconds` from now. Each is written the
// usual way, and Undo puts the old dates back.
async function expirePicked(seconds) {
  const cookies = pickedCookies();
  const expirationDate = Math.floor(Date.now() / 1000) + seconds;
  const changed = [];
  const failures = [];

  state.saving = true;
  try {
    for (const cookie of cookies) {
      const { ok, error } = await writeCookie(cookie, { ...valuesOf(cookie), session: false, expirationDate });
      if (ok) {
        changed.push(cookie);
      } else {
        failures.push(cookie.name + ": " + error);
      }
    }
  } finally {
    state.saving = false;
  }

  const when = { 3600: "1 hour", 86400: "1 day", 604800: "1 week", 31536000: "1 year" }[seconds];
  showMainMessage(
    pluralise(changed.length, "cookie now expires", "cookies now expire") + " in " + when + "." +
      (failures.length > 0 ? " Chrome refused " + failures.join(" ") : ""),
    failures.length > 0
  );
  await offerUndo(el("main-message"), { kind: "expiry", restore: changed });
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

// --- side panel ------------------------------------------------------------

// The window this page is in. Read at the start, so "Open in side panel"
// doesn't have to wait for it between the click and opening the panel, and
// the side panel can tell its own window's tabs from other windows'.
let windowId = null;
chrome.windows.getCurrent().then(
  (current) => {
    windowId = current.id;
  },
  (error) => console.warn("Couldn't read the current window:", error)
);

// Chrome only opens the side panel straight from a click, so nothing else is
// awaited between the click and open(). There's no side_panel entry in the
// manifest: the panel's page is set here, once the permission is granted.
async function openInPanel() {
  const { granted, error } = await requestPermission(PANEL_PERMISSION);
  if (error) {
    showMainMessage(error, true);
    return;
  }
  if (!granted) {
    showMainMessage("Chrome didn't allow the side panel, so cookieZ can't open there.", true);
    return;
  }
  try {
    await chrome.sidePanel.setOptions({ path: "popup/popup.html?panel=1", enabled: true });
    await chrome.sidePanel.open({ windowId });
  } catch (openError) {
    const message = describeError(openError);
    showMainMessage(
      message.includes("user gesture")
        ? "Chrome only opens the side panel straight from a click. Please click the button again."
        : "Couldn't open the side panel: " + message,
      true
    );
    return;
  }
  window.close();
}

// In the side panel, the page follows the active tab of its window: another
// tab chosen, or the tab going to a new address. Like the live table, it
// never pulls the rug: while the editor or another screen is open, or a
// question is waiting for an answer, it waits, and catches up after. Nothing
// about the tabs is saved.
let tabTimer = null;
let tabPending = false;

function followActiveTab() {
  tabPending = true;
  if (tabTimer === null) {
    // A page load reports several changes in a row. One reload covers them.
    tabTimer = setTimeout(runTabFollow, 200);
  }
}

// The blocked and error screens have nothing to lose, so they don't wait.
function tabFollowWaits() {
  const showing = currentState();
  return showing !== "blocked" && showing !== "error" && liveRedrawWaits();
}

async function runTabFollow() {
  if (tabFollowWaits()) {
    tabTimer = setTimeout(runTabFollow, 1000);
    return;
  }
  tabPending = false;
  try {
    await loadCurrentPage();
  } catch (error) {
    showError(error);
  }
  tabTimer = null;
  // Another change came in while that was loading.
  if (tabPending) {
    followActiveTab();
  }
}

if (inPanel) {
  chrome.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) {
      followActiveTab();
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.active && tab.windowId === windowId && (change.url || change.status === "complete")) {
      followActiveTab();
    }
  });
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
  message.textContent = "";

  // Has to run straight from the click, or Chrome won't show the prompt.
  const { granted, error } = await requestHostAccess();

  if (error) {
    message.textContent = error;
    return;
  }

  if (!granted) {
    message.textContent =
      "Access was declined, so cookies can't be listed. Click Grant access to try again.";
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
// In a tab or the side panel, the tab may have moved to another site, so read
// its address again too.
el("refresh-button").addEventListener("click", () => (inTab || inPanel ? loadCurrentPage() : refresh()));
el("tab-button").hidden = inTab || inPanel;
el("tab-button").addEventListener("click", openInTab);
el("panel-button").hidden = inTab || inPanel;
el("panel-button").addEventListener("click", openInPanel);
// A result or an error from these goes on the main screen, so get out of its way.
for (const item of document.querySelectorAll(".menu-item")) {
  item.addEventListener("click", () => el("more-menu").hidePopover());
}
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
el("report-open").addEventListener("click", () =>
  openReport(pageCookies, (cookie) => isProtected(state.protectedKeys, cookie))
);
el("report-back").addEventListener("click", closeReport);
el("changes-back").addEventListener("click", closeChanges);
el("kept-open").addEventListener("click", openKept);
el("kept-back").addEventListener("click", closeKept);
el("kept-clear").addEventListener("click", startKeptConfirm);
el("kept-confirm-yes").addEventListener("click", stopKeepingAll);
el("kept-confirm-no").addEventListener("click", () => {
  cancelKeptConfirm();
  el("kept-clear").focus();
});

el("rules-open").addEventListener("click", openRules);
el("rules-back").addEventListener("click", closeRules);
el("rules-grant").addEventListener("click", grantRules);
onRadioChoice("site-rule", chooseSiteRule);
onRadioChoice("everywhere-rule", askEverywhere);
el("rules-everywhere-yes").addEventListener("click", () => chooseEverywhere(BLOCK));
el("rules-everywhere-no").addEventListener("click", () => {
  el("rules-everywhere-confirm").hidden = true;
  focusChecked("everywhere-rule");
});
// The offer is hidden after either answer, so the focus goes back to the
// choice that made it.
el("rules-cleanup-yes").addEventListener("click", () => {
  focusChecked("site-rule");
  runCleanup();
});
el("rules-delete-on-block").addEventListener("change", toggleDeleteOnBlock);
el("rules-trackers").addEventListener("change", toggleTrackers);
el("rules-trackers-cleanup-yes").addEventListener("click", () => {
  el("rules-trackers").focus();
  runCleanup();
});
el("rules-trackers-cleanup-no").addEventListener("click", () => {
  el("rules-trackers").focus();
  hideCleanup();
});
el("data-button").addEventListener("click", startSiteDataClear);
el("data-yes").addEventListener("click", () => runSiteDataClear(false));
el("data-yes-reload").addEventListener("click", () => runSiteDataClear(true));
el("data-no").addEventListener("click", () => {
  cancelSiteDataClear();
  el("data-button").focus();
});
el("whats-new-close").addEventListener("click", () => {
  el("whats-new").hidden = true;
  el("search-input").focus();
});
el("review-open").addEventListener("click", async () => {
  el("review-ask").hidden = true;
  el("search-input").focus();
  if (await openReviewPage(el("main-message"))) {
    await recordAnswer("done");
  }
});
el("review-later").addEventListener("click", async () => {
  el("review-ask").hidden = true;
  el("search-input").focus();
  await recordAnswer(el("review-later").dataset.answer);
});
el("help-review").addEventListener("click", () => openReviewPage(el("help-review-message")));
el("rules-backup").addEventListener("click", saveRulesBackup);
el("rules-load").addEventListener("change", readRulesBackup);
el("rules-load-yes").addEventListener("click", loadRulesBackup);
el("rules-load-no").addEventListener("click", () => {
  cancelLoad();
  el("rules-load").focus();
});
el("rules-cleanup-no").addEventListener("click", () => {
  focusChecked("site-rule");
  hideCleanup();
});
el("rules-clear").addEventListener("click", startRulesConfirm);
el("rules-confirm-yes").addEventListener("click", clearAllRules);
el("rules-confirm-no").addEventListener("click", () => {
  cancelRulesConfirm();
  el("rules-clear").focus();
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
el("export-back").addEventListener("click", closeExport);
el("export-copy").addEventListener("click", copyExport);
el("export-download").addEventListener("click", downloadExport);
for (const radio of document.querySelectorAll('input[name="format"]')) {
  radio.addEventListener("change", showExportText);
}
// Typing a password puts the unlocked text back in the box, in case it was
// showing a locked copy, and hides the sign-in warning.
el("export-password").addEventListener("input", showExportText);
el("export-password-show").addEventListener("change", () => {
  el("export-password").type = el("export-password-show").checked ? "text" : "password";
});
el("import-password-show").addEventListener("change", () => {
  el("import-password").type = el("import-password-show").checked ? "text" : "password";
});
// Enter in the password box does the same as Check.
el("import-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    checkImport();
  }
});

el("import-button").addEventListener("click", openImport);
el("import-back").addEventListener("click", closeImport);
el("import-check").addEventListener("click", checkImport);
el("import-confirm").addEventListener("click", runImport);
el("import-cancel").addEventListener("click", resetImportPreview);
el("import-compare").addEventListener("click", compareImport);
el("compare-back").addEventListener("click", closeCompare);
el("import-file").addEventListener("change", readImportFile);
// A changed paste has to be checked again before it can be imported.
el("import-text").addEventListener("input", () => {
  el("import-move").checked = false;
  forgetImportPassword();
  resetImportPreview();
});
// Ticking "Put them on this site instead" checks again with the cookies
// moved, and leaves focus on the box.
el("import-move").addEventListener("change", async () => {
  await checkImport();
  el("import-move").focus();
});

// A partitioned cookie has to be Secure, so ticking one ticks the other.
el("field-partitioned").addEventListener("change", () => {
  if (el("field-partitioned").checked) {
    el("field-secure").checked = true;
  }
});
el("name-copy").addEventListener("click", () =>
  copyWithFeedback(el("name-copy"), el("field-name").value.trim())
);
// Copies the value as it would be saved: on one line, if edited as JSON.
el("value-copy").addEventListener("click", () =>
  copyWithFeedback(el("value-copy"), valueToSave().value ?? el("field-value").value)
);
el("field-value").addEventListener("input", showDecoded);
el("field-value").addEventListener("input", showValueSize);
el("field-name").addEventListener("input", showValueSize);
el("field-name").addEventListener("input", showKnownName);
el("edit-duplicate").addEventListener("click", duplicateCookie);
el("edit-setcookie").addEventListener("click", copySetCookie);
el("field-json").addEventListener("change", toggleJson);
el("field-value").addEventListener("input", showJsonChoice);
el("picked-keep").addEventListener("click", () => keepPicked(true));
el("picked-unkeep").addEventListener("click", () => keepPicked(false));
// Unticks every cookie, including any a search is hiding.
el("picked-clear").addEventListener("click", () => {
  const before = picked.size;
  picked = new Set();
  for (const box of document.querySelectorAll("#cookie-rows td.pick input")) {
    box.checked = false;
  }
  scopeAfterPicking(before);
  // The bar this button was on is now hidden. The header tick box is the
  // nearest thing that does the same job.
  (el("pick-all").disabled ? el("search-input") : el("pick-all")).focus();
});
for (const button of document.querySelectorAll("[data-picked-expire]")) {
  button.addEventListener("click", () => expirePicked(Number(button.dataset.pickedExpire)));
}
for (const button of document.querySelectorAll("[data-expire-in]")) {
  button.addEventListener("click", () => expireIn(Number(button.dataset.expireIn)));
}
el("decoded-copy").addEventListener("click", () =>
  copyWithFeedback(el("decoded-copy"), el("value-decoded-text").textContent)
);

el("help-button").addEventListener("click", () => {
  el("main-message").textContent = "";
  showState("help");
  el("help-back").focus();
});
el("help-back").addEventListener("click", () => showState("main"));

// --- keyboard --------------------------------------------------------------

// Each screen's way back, for Esc.
const BACK_BUTTONS = {
  rules: "rules-back",
  kept: "kept-back",
  changes: "changes-back",
  report: "report-back",
  edit: "edit-cancel",
  export: "export-back",
  import: "import-back",
  compare: "compare-back",
  help: "help-back",
};

// Esc on the Block cookies screen first backs out of a question that's open,
// as its Cancel button would, focus included. Returns whether there was one.
function cancelRulesQuestion() {
  const questions = [
    ["rules-everywhere-confirm", "rules-everywhere-no"],
    ["rules-confirm", "rules-confirm-no"],
    ["rules-load-confirm", "rules-load-no"],
    ["rules-cleanup", "rules-cleanup-no"],
    ["rules-trackers-cleanup", "rules-trackers-cleanup-no"],
  ];
  for (const [question, cancel] of questions) {
    if (!el(question).hidden) {
      el(cancel).click();
      return true;
    }
  }
  return false;
}

// Whether the main screen is asking something ("Delete these cookies?",
// Clear site data, or a row's "Sure?"), which "n" shouldn't walk away from.
function waitingForAnswer() {
  return (
    !el("confirm-row").hidden ||
    !el("data-confirm").hidden ||
    el("cookie-rows").querySelector(".armed") !== null
  );
}

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
    if (currentState() === "rules" && cancelRulesQuestion()) {
      event.preventDefault();
    } else if (back) {
      event.preventDefault();
      el(back).click();
    } else if (currentState() === "main" && !el("confirm-row").hidden) {
      event.preventDefault();
      cancelConfirm();
      el("delete-button").focus();
    } else if (currentState() === "main" && !el("data-confirm").hidden) {
      event.preventDefault();
      cancelConfirm();
      el("data-button").focus();
    }
    return;
  }

  // "/" jumps to the search box, and "n" opens a new cookie, unless you're
  // typing somewhere already.
  const typing = event.target.closest("input, textarea, select");
  if (currentState() !== "main" || typing) {
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    el("search-input").focus();
  } else if ((event.key === "n" || event.key === "N") && !waitingForAnswer()) {
    event.preventDefault();
    openEditor(null);
  }
});
el("confirm-no").addEventListener("click", () => {
  cancelConfirm();
  el("delete-button").focus();
});
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
