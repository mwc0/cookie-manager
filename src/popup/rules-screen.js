// The Block cookies screen: the site rules, the trackers switch, saving and
// loading a copy of the rules, and deleting what a blocked site already has.
// Also Clear site data, which needs the same kind of optional permission.

import {
  hasHostAccess,
  hasRulesAccess,
  requestRulesAccess,
  hasPermission,
  requestPermission,
  EVERYWHERE_PERMISSION,
  SITE_DATA_PERMISSION,
} from "../lib/permissions.js";
import {
  ALLOW,
  SESSION,
  OWN_ONLY,
  BLOCK,
  loadRules,
  siteFor,
  ruleFor,
  hasAnyRule,
  listRules,
  rulesAvailable,
  applyRules,
  rulesInForce,
  setSiteRule,
  removeSiteRule,
  setEverywhere,
  setDeleteOnBlock,
  setTrackers,
  clearRules,
  everywhereAvailable,
  thirdPartyStatus,
  rulesToBackup,
  rulesFromBackup,
  replaceRules,
} from "../lib/rules.js";
import { TRACKER_DOMAINS } from "../lists/trackers.js";
import {
  getCookiesForScope,
  getCookiesForDomain,
  removeCookies,
  baseHostOf,
  cookieKey,
} from "../lib/cookies.js";
import { loadProtected, partitionByProtection } from "../lib/protect.js";
import { pluralise, formatCount, describeError } from "../lib/format.js";
import { loadCleared } from "../lib/stats.js";
import { state } from "./state.js";
import { el, showState, showMainMessage, currentState } from "./ui.js";
import { refresh, cancelConfirm } from "./popup.js";
import { offerUndo, appendReloadButton } from "./undo-button.js";

// The site rules, and whether Chrome has given permission to set them. See
// src/lib/rules.js.
let rules = { everywhere: ALLOW, sites: {}, trackers: false };
let rulesAllowed = false;

// Whether the two other optional permissions have been given, found out
// when the popup opens. Knowing in advance means a click can open Chrome's
// prompt straight away, while Chrome still counts it as coming from the
// click.
let everywhereAllowed = false;
let siteDataAllowed = false;

// The cookies "Delete them" on the rules screen would remove, after
// blocking a site or the trackers. Counted when the offer is made, so the
// number shown is the number deleted.
let cleanupCookies = [];

// An incognito window shows the rules but can't change them.
const incognito = Boolean(chrome.extension && chrome.extension.inIncognitoContext);

// --- site rules ------------------------------------------------------------
//
// Which sites may set cookies. cookieZ saves the list and hands it to Chrome,
// and Chrome does the blocking. See src/lib/rules.js.

// What each choice is called, in the list and in the messages.
const RULE_NAMES = {
  [ALLOW]: "Allow all cookies",
  [SESSION]: "Clear when Chrome closes",
  [OWN_ONLY]: "Block other companies' cookies",
  [BLOCK]: "Block all cookies",
};

// The backup chosen with "Load a copy", waiting for "Replace my rules".
let loadedBackup = null;

// The rule this page is getting. Without the permission Chrome isn't
// following any rule, whatever is saved.
export function pageRule() {
  return rulesAllowed ? ruleFor(rules, state.page.hostname) : ALLOW;
}

// Reads the saved rules when a page is loaded, and checks Chrome is still
// following them. If it isn't, they're set again. This is a safety net:
// nothing else would notice if Chrome lost them.
export async function loadSiteRules() {
  // None of these depends on another, so they're asked all at once.
  const [loaded, rulesAccess, everywhere, siteData] = await Promise.all([
    loadRules(),
    hasRulesAccess(),
    hasPermission(EVERYWHERE_PERMISSION),
    hasPermission(SITE_DATA_PERMISSION),
  ]);
  rules = loaded.rules;
  rulesAllowed = rulesAccess;
  everywhereAllowed = everywhere;
  siteDataAllowed = siteData;

  if (loaded.error) {
    showMainMessage(loaded.error, true);
    return;
  }
  if (!rulesAllowed || incognito || !hasAnyRule(rules)) {
    return;
  }

  if ((await rulesInForce(rules)) === false) {
    // Setting them again can take a few seconds with the trackers list, as
    // on the Block cookies screen, so the main screen says so meanwhile.
    showMainMessage(SAVING, false);
    const error = await applyRules(rules);
    showMainMessage(
      error
        ? "Chrome has stopped following your site rules, and cookieZ couldn't set them again. " + error
        : "Chrome had stopped following your site rules, so cookieZ has set them again.",
      Boolean(error)
    );
  }
}

// The Block button in the header. It says what's being done to this site's
// cookies, and lights up while anything is.
export function showRulesLink() {
  const rule = pageRule();
  const labels = {
    [ALLOW]: ["Block", "Choose which cookies this site may set"],
    [SESSION]: ["Clears on close", "Chrome deletes this site's cookies when it closes"],
    [OWN_ONLY]: ["Blocking others", "Other companies' cookies are blocked on this site"],
    [BLOCK]: ["Blocked", "Every cookie is blocked on this site"],
  };
  let [label, title] = labels[rule] || labels[ALLOW];

  // Known trackers are blocked here too, unless the site has a rule of its
  // own: "Allow all cookies" lets them through, and every other rule
  // already has a name that says more.
  const trackersHere =
    rule === ALLOW && rulesAllowed && rules.trackers && !rules.sites[siteFor(rules, state.page.hostname)];
  if (trackersHere) {
    label = "Blocking trackers";
    title = "Known trackers' cookies are blocked on this site";
  }

  const lit = rule !== ALLOW || trackersHere;
  el("rules-open-label").textContent = label;
  el("rules-open").title = title;
  el("rules-open").classList.toggle("on", lit);
  // While lit, the label says what's happening ("Blocked"), not what the
  // button does, so a screen reader is told both. Unlit, "Block" already
  // says it, and the tip is read after it.
  if (lit) {
    el("rules-open").setAttribute("aria-label", label + ": choose which cookies this site may set");
  } else {
    el("rules-open").removeAttribute("aria-label");
  }
}

export async function openRules() {
  el("main-message").textContent = "";
  el("rules-message").textContent = "";
  el("rules-everywhere-confirm").hidden = true;
  cancelRulesConfirm();
  cancelLoad();
  hideCleanup();
  showState("rules");
  await drawRules();
  el("rules-back").focus();
}

function showRulesMessage(text, isError) {
  const message = el("rules-message");
  message.textContent = text;
  message.className = isError ? "result error" : "result";
}

const SAVING = "Saving…";

// Every change to the rules goes through here. Chrome can take a few
// seconds to take in every rule now there are trackers, so the screen says
// "Saving…" and its controls are switched off until Chrome is done, error
// or not. `change` is called with no arguments and its result handed back.
async function savingRules(change) {
  const focused = document.activeElement;
  el("rules-body").disabled = true;
  showRulesMessage(SAVING, false);
  try {
    return await change();
  } finally {
    el("rules-body").disabled = false;
    if (el("rules-message").textContent === SAVING) {
      el("rules-message").textContent = "";
    }
    // Switching a control off takes the focus away from it. Give it back.
    if (focused && focused !== document.body && document.activeElement !== focused) {
      focused.focus();
    }
  }
}

function setRadio(name, value, disabled) {
  for (const radio of document.querySelectorAll('input[name="' + name + '"]')) {
    radio.checked = radio.value === value;
    radio.disabled = disabled;
  }
}

// Calls `apply` with the value of a group of radio buttons once a choice is
// made, but not on every arrow press.
//
// A browser moves the tick, and fires "change", on each arrow key, so
// someone arrowing past "Block other companies' cookies" would get Chrome's
// permission prompt, and arrowing onto "Block all cookies" would ask "are
// you sure?". So a tick moved with the arrows only waits. It's applied on
// Space or Enter, or when the focus leaves the group (Tab, or a click
// elsewhere). A click, or Space on a choice not ticked yet, applies at once,
// as before.
export function onRadioChoice(name, apply) {
  const radios = [...document.querySelectorAll('input[name="' + name + '"]')];
  let arrowing = false; // an arrow key is down, so a "change" now came from it
  let waiting = false; // a choice made with the arrows, not yet applied

  const applyChecked = () => {
    waiting = false;
    const checked = radios.find((radio) => radio.checked);
    if (checked) {
      apply(checked.value);
    }
  };

  for (const radio of radios) {
    radio.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow")) {
        arrowing = true;
      } else if ((event.key === " " || event.key === "Enter") && waiting) {
        event.preventDefault();
        applyChecked();
      }
    });
    radio.addEventListener("keyup", () => {
      arrowing = false;
    });
    radio.addEventListener("change", () => {
      if (arrowing) {
        waiting = true;
      } else {
        applyChecked();
      }
    });
    // Applied a moment later, once the focus has landed where it was going,
    // so it can be kept there. Only while the screen is still showing:
    // leaving it with Esc drops a choice that was never applied, and the
    // screen is drawn from the saved rules next time.
    radio.addEventListener("focusout", (event) => {
      if (waiting && !radios.includes(event.relatedTarget)) {
        setTimeout(() => {
          if (waiting && currentState() === "rules") {
            applyChecked();
          }
        }, 0);
      }
    });
  }
}

// Whether the focus is on one of a group's radio buttons.
function focusInGroup(name) {
  const active = document.activeElement;
  return Boolean(active && active.name === name && active.type === "radio");
}

export function focusChecked(name) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  if (checked) {
    checked.focus();
  }
}

// Draws the screen from the saved rules. Site names are put in with
// textContent, like everything else that comes from a website.
// The line at the top of the Block cookies screen: how many cookies cookieZ
// has cleared, ever, and what it's blocking now. Only what cookieZ itself
// did or set is counted, so every number is exact.
async function showStats() {
  const cleared = await loadCleared();
  const sentences = [
    cleared === 0
      ? "cookieZ hasn't cleared any cookies yet."
      : "cookieZ has cleared " + pluralise(cleared, "cookie", "cookies") + " so far.",
  ];

  // Only claimed while Chrome is actually following the rules.
  if (rulesAllowed) {
    const sites = listRules(rules).filter((entry) => entry.rule === OWN_ONLY || entry.rule === BLOCK).length;
    const onSites = sites > 0 ? "on " + pluralise(sites, "site", "sites") : "";
    const fromTrackers = rules.trackers ? "from " + pluralise(TRACKER_DOMAINS.length, "known tracker", "known trackers") : "";
    const blocking = [onSites, fromTrackers].filter(Boolean).join(" and ");
    if (blocking) {
      sentences.push("Blocking cookies " + blocking + ".");
    }
  }
  el("rules-stats").textContent = sentences.join(" ");
}

// After a delete or an Undo made from the Block cookies screen itself.
export async function refreshStats() {
  if (!el("state-rules").hidden) {
    await showStats();
  }
}

async function drawRules() {
  const loaded = await loadRules();
  rules = loaded.rules;
  rulesAllowed = await hasRulesAccess();
  if (loaded.error) {
    showRulesMessage(loaded.error, true);
  }

  // Without the permission, the choices are only shown if there are saved
  // rules to show. In incognito they're shown but can't be changed.
  const canChange = rulesAllowed && !incognito;
  el("rules-gate").hidden = rulesAllowed || incognito;
  el("rules-gate-saved").hidden = !hasAnyRule(rules);
  el("rules-incognito").hidden = !incognito;
  el("rules-body").hidden = !rulesAllowed && !hasAnyRule(rules);

  const site = siteFor(rules, state.page.hostname);
  const own = baseHostOf(state.page.hostname);
  el("rules-site-name").textContent = site;
  el("rules-site-note").hidden = site === own;
  el("rules-site-note").textContent =
    site === own ? "" : "This rule was set for " + site + ", which covers " + own + " too.";

  // With trackers blocked, a site without a rule of its own isn't getting
  // "Allow all cookies", so none of its choices is ticked. Choosing that
  // one lets the trackers through here.
  const unticked = rules.trackers && rules.everywhere === ALLOW && !rules.sites[site];
  setRadio("site-rule", unticked ? null : rules.sites[site] || rules.everywhere, !canChange);
  setRadio("everywhere-rule", rules.everywhere, !canChange);
  el("rules-delete-on-block").checked = rules.deleteOnBlock;
  el("rules-delete-on-block").disabled = !canChange;
  el("rules-trackers").checked = rules.trackers;
  el("rules-trackers-count").textContent = String(TRACKER_DOMAINS.length);
  el("rules-trackers").disabled = !canChange;
  await showThirdPartyNote(canChange);
  await showStats();

  const entries = listRules(rules);
  const rows = el("rules-rows");
  rows.textContent = "";

  for (const entry of entries) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.className = "mono rules-site";
    name.textContent = entry.site;
    row.appendChild(name);

    const rule = document.createElement("td");
    rule.className = "rules-rule";
    rule.textContent = RULE_NAMES[entry.rule];
    row.appendChild(rule);

    // Filled in below, once counted.
    const count = document.createElement("td");
    count.className = "rules-count";
    count.textContent = "…";
    row.appendChild(count);

    const action = document.createElement("td");
    action.className = "rules-action";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-button rules-remove";
    button.textContent = "Remove";
    button.setAttribute("aria-label", "Remove the rule for " + entry.site);
    button.disabled = !canChange;
    button.addEventListener("click", () => removeRule(entry.site));
    action.appendChild(button);
    row.appendChild(action);

    rows.appendChild(row);
  }

  el("rules-table").hidden = entries.length === 0;
  el("rules-empty").hidden = entries.length > 0;
  el("rules-clear").hidden = !hasAnyRule(rules) || !el("rules-confirm").hidden;
  el("rules-clear").disabled = !canChange;
  el("rules-backup").disabled = !hasAnyRule(rules);
  el("rules-load").disabled = !canChange;

  await countRuleCookies(entries);
}

// How many cookies each listed site has now. Only the sites on the list are
// looked up, never any others.
async function countRuleCookies(entries) {
  const cells = el("rules-rows").querySelectorAll("td.rules-count");
  await Promise.all(entries.map(async (entry, index) => {
    let text = "?";
    try {
      const found = await getCookiesForDomain(entry.site);
      text = formatCount(found.length);
    } catch (error) {
      console.warn("Couldn't count cookies for " + entry.site + ":", error);
    }
    if (cells[index]) {
      cells[index].textContent = text;
    }
  }));
}

// The line under "On every other site". It says when Chrome's own setting,
// another extension or an administrator is already deciding about other
// companies' cookies, since cookieZ can't then change it.
async function showThirdPartyNote(canChange) {
  const note = el("rules-everywhere-note");
  const option = document.querySelector('input[name="everywhere-rule"][value="own-only"]');
  const status = await thirdPartyStatus();
  let text = "";
  if (status && !status.canChange) {
    text = "Another extension or your administrator controls whether other companies' cookies are blocked, so cookieZ can't change it.";
    option.disabled = true;
  } else if (status && !status.allowed && !status.ours) {
    text = "Chrome is already blocking other companies' cookies on every site, in its own settings.";
  }
  option.disabled = option.disabled || !canChange;
  note.textContent = text;
  note.hidden = text === "";
}

// The button on the rules screen that asks Chrome for the permission.
export async function grantRules() {
  const { granted, error } = await requestRulesAccess();
  if (error) {
    showRulesMessage(error, true);
    return;
  }
  if (!granted) {
    showRulesMessage(
      "Chrome didn't give permission, so nothing has changed. The rest of cookieZ works as before.",
      false
    );
    return;
  }
  if (!rulesAvailable()) {
    showRulesMessage("Permission given. Close cookieZ and open it again to finish.", false);
    return;
  }

  // Rules saved before the permission was taken away come back into force.
  const applyError = hasAnyRule(rules) ? await savingRules(() => applyRules(rules)) : null;
  el("rules-message").textContent = "";
  await drawRules();
  if (applyError) {
    showRulesMessage(applyError, true);
  }
}

export async function chooseSiteRule(choice) {
  hideCleanup();
  // A choice applied because the focus moved on (see onRadioChoice())
  // leaves the focus where it went.
  const refocus = focusInGroup("site-rule");
  const site = siteFor(rules, state.page.hostname);
  const result = await savingRules(() => setSiteRule(site, choice));
  rules = result.rules;
  await drawRules();
  if (refocus) {
    focusChecked("site-rule");
  }

  if (result.error) {
    showRulesMessage(result.error, true);
    return;
  }

  showRulesMessage(
    choice === BLOCK
      ? "All cookies are now blocked on " + site + "."
      : choice === OWN_ONLY
        ? "Other companies' cookies are now blocked on " + site + "."
        : choice === SESSION
          ? "Chrome will delete " + site + "'s cookies every time it closes."
          : site + " may set any cookie" + (rules.trackers ? ", known trackers' included." : "."),
    false
  );
  if (choice === BLOCK) {
    await offerCleanup(site);
  }
}

// Blocking a site leaves the cookies it already has. This counts them and
// offers to delete them. Kept cookies are left out, as in every delete.
async function offerCleanup(site) {
  let found;
  try {
    found = await getCookiesForScope("domain", { origin: "https://" + site, hostname: site });
  } catch (error) {
    return;
  }

  const { keys } = await loadProtected();
  state.protectedKeys = keys;
  const { deletable, kept } = partitionByProtection(state.protectedKeys, found);
  if (deletable.length === 0) {
    return;
  }

  cleanupCookies = deletable;

  // "Delete without asking": straight through the usual delete, with Undo.
  if (rules.deleteOnBlock) {
    await runCleanup(el("rules-message").textContent + " ");
    return;
  }

  el("rules-cleanup-text").textContent =
    "It still has " +
    pluralise(deletable.length, "cookie", "cookies") +
    " saved." +
    (kept.length > 0
      ? " " + pluralise(kept.length, "kept cookie", "kept cookies") + " will be left alone."
      : "");
  el("rules-cleanup").hidden = false;
  // Like every other "are you sure?" in cookieZ, the focus goes to the
  // safe answer, so a screen reader reads the question.
  el("rules-cleanup-no").focus();
}

// The same, after turning on the trackers switch: their cookies already
// saved, from every listed domain. It's a fixed list, never a search of
// every site. Without access to sites' cookies there's nothing to count, so
// it says nothing.
async function offerTrackerCleanup() {
  if (!(await hasHostAccess())) {
    return;
  }

  let found;
  try {
    const lists = await Promise.all(TRACKER_DOMAINS.map((domain) => getCookiesForDomain(domain)));
    // A cookie for a subdomain could come back under two listed domains.
    const unique = new Map();
    for (const cookie of lists.flat()) {
      unique.set(cookieKey(cookie), cookie);
    }
    found = [...unique.values()];
  } catch (error) {
    return;
  }

  const { keys } = await loadProtected();
  state.protectedKeys = keys;
  const { deletable, kept } = partitionByProtection(state.protectedKeys, found);
  if (deletable.length === 0) {
    return;
  }

  cleanupCookies = deletable;

  if (rules.deleteOnBlock) {
    await runCleanup(el("rules-message").textContent + " ");
    return;
  }

  el("rules-trackers-cleanup-text").textContent =
    "These companies already have " +
    pluralise(deletable.length, "cookie", "cookies") +
    " saved." +
    (kept.length > 0
      ? " " + pluralise(kept.length, "kept cookie", "kept cookies") + " will be left alone."
      : "");
  el("rules-trackers-cleanup").hidden = false;
  el("rules-trackers-cleanup-no").focus();
}

export function hideCleanup() {
  cleanupCookies = [];
  el("rules-cleanup").hidden = true;
  el("rules-trackers-cleanup").hidden = true;
}

// `before` is put in front of the result, when deleting follows straight on
// from blocking.
export async function runCleanup(before = "") {
  const cookies = cleanupCookies;
  hideCleanup();

  const { removed, removedCookies, failed } = await removeCookies(cookies);
  showRulesMessage(
    (typeof before === "string" ? before : "") +
    (failed.length === 0
      ? "Deleted " + pluralise(removed, "cookie", "cookies") + "."
      : "Deleted " +
          pluralise(removed, "cookie", "cookies") +
          ". " +
          pluralise(failed.length, "cookie", "cookies") +
          " could not be deleted, and may be protected by the browser."),
    failed.length > 0
  );
  await offerUndo(el("rules-message"), { kind: "delete", restore: removedCookies });
}

export async function toggleDeleteOnBlock() {
  const result = await savingRules(() => setDeleteOnBlock(el("rules-delete-on-block").checked));
  rules = result.rules;
  el("rules-delete-on-block").checked = rules.deleteOnBlock;
  if (result.error) {
    showRulesMessage(result.error, true);
  }
}

// The known trackers switch. Turning it on also offers to delete the
// trackers' cookies already saved, since blocking only stops new ones.
export async function toggleTrackers() {
  hideCleanup();
  const on = el("rules-trackers").checked;
  const result = await savingRules(() => setTrackers(on));
  rules = result.rules;
  await drawRules();
  el("rules-trackers").focus();

  if (result.error) {
    showRulesMessage(result.error, true);
    return;
  }
  showRulesMessage(
    on
      ? "Known trackers' cookies are now blocked on every site."
      : "Known trackers' cookies are no longer blocked on every site.",
    false
  );
  if (on) {
    await offerTrackerCleanup();
  }
}

// "Block all cookies" for every other site changes every site at once, so
// it asks first. The choice is put back until the answer.
//
// "Block other companies' cookies" needs one more permission, asked for
// here, from the click, the first time.
export async function askEverywhere(choice) {
  if (choice === BLOCK && rules.everywhere !== BLOCK) {
    setRadio("everywhere-rule", rules.everywhere, false);
    el("rules-everywhere-confirm").hidden = false;
    el("rules-everywhere-no").focus();
    return;
  }
  if (choice === OWN_ONLY && !everywhereAllowed) {
    const { granted, error } = await requestPermission(EVERYWHERE_PERMISSION);
    everywhereAllowed = granted;
    if (!granted) {
      setRadio("everywhere-rule", rules.everywhere, false);
      showRulesMessage(
        error || "Chrome didn't give permission, so nothing has changed. Your other rules work as before.",
        Boolean(error)
      );
      return;
    }
    if (!everywhereAvailable()) {
      setRadio("everywhere-rule", rules.everywhere, false);
      showRulesMessage("Permission given. Close cookieZ and open it again, then choose this again.", false);
      return;
    }
  }
  await chooseEverywhere(choice);
}

export async function chooseEverywhere(choice) {
  // From "Yes, block all" or a radio button the focus is still on, the
  // focus goes back to the choice. From a choice applied because the focus
  // moved on (see onRadioChoice()), it stays where it went.
  const refocus = !el("rules-everywhere-confirm").hidden || focusInGroup("everywhere-rule");
  el("rules-everywhere-confirm").hidden = true;
  const result = await savingRules(() => setEverywhere(choice));
  rules = result.rules;
  await drawRules();
  if (refocus) {
    focusChecked("everywhere-rule");
  }

  if (result.error) {
    showRulesMessage(result.error, true);
    return;
  }
  showRulesMessage(
    choice === BLOCK
      ? "Cookies are now blocked on every site without a rule of its own."
      : choice === OWN_ONLY
        ? "Other companies' cookies are now blocked on every site without a rule of its own."
        : "Cookies are allowed again on every site without a rule of its own.",
    false
  );
}

// --- clearing a site's data -------------------------------------------------
//
// Cookies go through cookieZ's own delete, so Kept cookies stay and Undo can
// put them back. Everything else the site stores is cleared by Chrome
// (chrome.browsingData), which can't count it, list it, or put it back. The
// question before it says so.

// What Chrome clears for the site, besides cookies.
const SITE_DATA_TYPES = {
  localStorage: true,
  indexedDB: true,
  cacheStorage: true,
  serviceWorkers: true,
  fileSystems: true,
};

// The site's addresses: the exact one the tab is on, port included (a
// site on localhost:3000 stores its data under that), then the site with
// and without "www.", over HTTPS and HTTP.
function siteDataOrigins() {
  const base = baseHostOf(state.page.hostname);
  const origins = new Set([state.page.origin]);
  for (const host of [state.page.hostname, base, "www." + base]) {
    origins.add("https://" + host);
    origins.add("http://" + host);
  }
  return [...origins];
}

export async function startSiteDataClear() {
  if (!siteDataAllowed) {
    const { granted, error } = await requestPermission(SITE_DATA_PERMISSION);
    siteDataAllowed = granted;
    if (!granted) {
      showMainMessage(error || "Chrome didn't give permission, so nothing was cleared.", Boolean(error));
      return;
    }
  }
  if (!chrome.browsingData) {
    showMainMessage("Permission given. Close cookieZ and open it again to finish.", false);
    return;
  }

  let found;
  try {
    // Including the cookies other companies keep for this site, which are
    // as much this site's data as the rest.
    found = await getCookiesForScope("domain", state.page, { embedded: true });
  } catch (error) {
    showMainMessage("Couldn't count this site's cookies: " + describeError(error), true);
    return;
  }
  const { deletable, kept } = partitionByProtection(state.protectedKeys, found);
  state.siteDataCookies = deletable;

  const site = baseHostOf(state.page.hostname);
  el("data-confirm-text").textContent =
    (deletable.length > 0
      ? "Delete " + pluralise(deletable.length, "cookie", "cookies") + " from " + site + " and clear"
      : "Clear") +
    " everything else " + site + " has stored: local storage, databases, cache storage and offline files?" +
    (kept.length > 0 ? " " + pluralise(kept.length, "kept cookie", "kept cookies") + " will be left alone." : "") +
    " Undo can put the cookies back, but not the rest.";

  el("main-message").textContent = "";
  el("delete-button").hidden = true;
  el("export-button").hidden = true;
  el("data-button").hidden = true;
  el("data-confirm").hidden = false;
  el("data-no").focus();
}

export function cancelSiteDataClear() {
  cancelConfirm();
}

export async function runSiteDataClear() {
  const cookies = state.siteDataCookies;
  const site = baseHostOf(state.page.hostname);
  cancelSiteDataClear();
  // "Yes, clear it" has just been hidden. Without this the focus would be
  // lost.
  el("data-button").focus();

  const { removed, removedCookies, failed } = await removeCookies(cookies);
  let dataError = null;
  try {
    await chrome.browsingData.remove({ origins: siteDataOrigins() }, SITE_DATA_TYPES);
  } catch (error) {
    dataError = describeError(error);
  }

  showMainMessage(
    (cookies.length > 0 ? "Deleted " + pluralise(removed, "cookie", "cookies") + " and cleared " : "Cleared ") +
      site + "'s other stored data." +
      (failed.length > 0 ? " " + pluralise(failed.length, "cookie", "cookies") + " could not be deleted." : "") +
      (dataError ? " Chrome couldn't clear the rest: " + dataError : ""),
    failed.length > 0 || Boolean(dataError)
  );
  await offerUndo(el("main-message"), { kind: "delete", restore: removedCookies });
  // The page still has what it loaded. Reloading starts it afresh.
  appendReloadButton(el("main-message"));
  await refresh();
}

// --- a copy of the rules ---------------------------------------------------

// Saves the rules as a file, the same way Export saves cookies.
export function saveRulesBackup() {
  const url = URL.createObjectURL(new Blob([rulesToBackup(rules)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "cookiez-site-rules.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  showRulesMessage("Saving your rules as cookiez-site-rules.json.", false);
}

// Reads a chosen file and asks before replacing anything.
export async function readRulesBackup() {
  const input = el("rules-load");
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) {
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    showRulesMessage("Couldn't read that file: " + describeError(error), true);
    return;
  }

  const { rules: incoming, error } = rulesFromBackup(text);
  if (error) {
    showRulesMessage(error, true);
    return;
  }

  // The every-site choice needs a permission that can only be asked for
  // from a click on that choice, so without it the copy loads without it.
  let note = "";
  if (incoming.everywhere === OWN_ONLY && !everywhereAllowed) {
    incoming.everywhere = ALLOW;
    note = " It blocked other companies' cookies on every site; choose that again after loading.";
  }

  if (incoming.trackers) {
    note = " It also blocks known trackers' cookies." + note;
  }

  loadedBackup = incoming;
  const count = Object.keys(incoming.sites).length;
  el("rules-load-text").textContent = count > 0
    ? "Replace your rules with the " + pluralise(count, "site", "sites") + " in this file?" + note
    : "Replace your rules with the ones in this file? It has no sites in it." + note;
  el("rules-load-confirm").hidden = false;
  el("rules-load-no").focus();
}

export function cancelLoad() {
  loadedBackup = null;
  el("rules-load-confirm").hidden = true;
}

export async function loadRulesBackup() {
  const incoming = loadedBackup;
  cancelLoad();
  if (!incoming) {
    return;
  }
  const result = await savingRules(() => replaceRules(incoming));
  rules = result.rules;
  await drawRules();
  // The buttons that had the focus are gone, so it goes back to Load.
  el("rules-load").focus();
  showRulesMessage(
    result.error || "Loaded " + pluralise(Object.keys(incoming.sites).length, "site rule", "site rules") + ".",
    Boolean(result.error)
  );
}

async function removeRule(site) {
  hideCleanup();
  const index = listRules(rules).findIndex((entry) => entry.site === site);
  const result = await savingRules(() => removeSiteRule(site));
  rules = result.rules;
  await drawRules();
  // The row is gone, and its button with it. The focus goes to the Remove
  // button that took its place, or the one above, or Load if none is left.
  const buttons = el("rules-rows").querySelectorAll(".rules-remove");
  (buttons[Math.min(index, buttons.length - 1)] || el("rules-load")).focus();
  showRulesMessage(result.error || "Removed the rule for " + site + ".", Boolean(result.error));
}

// "Turn off all rules" asks first, like the delete panel.
export function startRulesConfirm() {
  el("rules-clear").hidden = true;
  el("rules-confirm").hidden = false;
  el("rules-confirm-no").focus();
}

export function cancelRulesConfirm() {
  el("rules-confirm").hidden = true;
  el("rules-clear").hidden = false;
}

export async function clearAllRules() {
  hideCleanup();
  const result = await savingRules(() => clearRules());
  rules = result.rules;
  cancelRulesConfirm();
  await drawRules();
  // "Turn off all rules" is hidden once there are none to turn off.
  (el("rules-clear").hidden ? el("rules-load") : el("rules-clear")).focus();
  showRulesMessage(
    result.error || "Every rule is off. Chrome is allowing cookies everywhere again.",
    Boolean(result.error)
  );
}

// Back to the table, loaded again, since cookies may have been deleted.
export async function closeRules() {
  el("rules-rows").textContent = "";
  hideCleanup();
  showState("main");
  await refresh();
  el("rules-open").focus();
}
