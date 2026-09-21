// Popup wiring: decides which screen to show, loads cookies, and runs the
// delete-with-scope flow.

import { hasHostAccess, requestHostAccess } from "../lib/permissions.js";
import {
  getCookiesForPage,
  getCookiesForScope,
  summarise,
  removeCookies,
  baseHostOf,
} from "../lib/cookies.js";
import { pluralise, formatCount } from "../lib/format.js";
import { renderCookieTable } from "./render.js";

// The site in the current tab: { origin, hostname }.
let page = null;

// The exact cookies the selected scope would delete. The delete runs against
// this array, which is the same one the on-screen count was taken from, so
// the number shown and the number removed can't disagree.
let scopeCookies = [];

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

  el("site-name").textContent = url.hostname;
  el("scope-target-page").textContent = url.hostname;
  el("scope-target-domain").textContent = baseHostOf(url.hostname);

  showState("main");
  await refresh();
}

// Re-read everything: the table for this site, and the count for the
// currently selected delete scope.
async function refresh() {
  await Promise.all([refreshTable(), refreshScope()]);
}

async function refreshTable() {
  try {
    const cookies = await getCookiesForPage(page);

    renderCookieTable(el("cookie-rows"), cookies);
    el("cookie-count").textContent = pluralise(cookies.length, "cookie", "cookies");

    const empty = cookies.length === 0;
    el("empty-message").hidden = !empty;
    el("cookie-table").hidden = empty;
  } catch (error) {
    showError(error);
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
  cancelConfirm();

  try {
    scopeCookies = await getCookiesForScope(selectedScope(), page);
  } catch (error) {
    scopeCookies = [];
    summaryLine.textContent = "Couldn't count the cookies in this scope: " + error.message;
    return;
  }

  const { count, domains } = summarise(scopeCookies);

  if (count === 0) {
    summaryLine.textContent = "Nothing to delete in this scope.";
    el("delete-button").disabled = true;
    return;
  }

  summaryLine.textContent =
    "Will delete " +
    pluralise(count, "cookie", "cookies") +
    (domains.length === 1
      ? " from " + domains[0]
      : " across " + pluralise(domains.length, "domain", "domains"));

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
