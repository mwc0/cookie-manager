// The Undo and Reload the site buttons added after a change, and Undo
// itself. Every delete, save, import and expiry change ends up here.

import { sitesOf } from "../lib/cookies.js";
import { loadProtected, isProtected } from "../lib/protect.js";
import { formatCount, describeError } from "../lib/format.js";
import { t, tn } from "../lib/i18n.js";
import { changeCleared } from "../lib/stats.js";
import {
  saveLastChange,
  loadLastChange,
  clearLastChange,
  undoChange,
  describeAge,
} from "../lib/undo.js";
import { state } from "./state.js";
import { el, showMainMessage } from "./ui.js";
import { refresh } from "./popup.js";
import { refreshStats } from "./rules-screen.js";
import { countJob } from "./small-screens.js";

// --- undo ------------------------------------------------------------------

// Remembers a change and adds an Undo button to its message. Setting the
// message's text later removes the button. That's fine: the change can
// still be undone from the next open, for up to 10 minutes.
export async function offerUndo(message, change) {
  // Every delete in the popup ends up here, so this is where the lifetime
  // count of cleared cookies goes up.
  if (change.kind === "delete") {
    await changeCleared((change.restore || []).length);
    await refreshStats();
  }
  if ((change.restore || []).length + (change.remove || []).length === 0) {
    return;
  }
  await countJob(message);
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
  button.textContent = t("main_undoButton");
  button.addEventListener("click", () => runUndo(message, button));
  message.append(" ", button);
}

// "Reload the site", after a change the open page won't notice until it
// loads again: a delete, Clear site data, an import or an Undo. It only
// ever reloads when clicked. Reloading a tab needs no permission.
export function appendReloadButton(message) {
  if (!state.page || typeof state.page.tabId !== "number") {
    return;
  }
  const tabId = state.page.tabId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-button reload-button";
  button.textContent = t("main_reloadButton");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await chrome.tabs.reload(tabId);
      button.textContent = t("main_reloaded");
    } catch (error) {
      button.textContent = t("main_reloadFailed", describeError(error));
    }
  });
  message.append(" ", button);
}

// "Deleted 5 cookies from example.com", "Imported 12 cookies across 3
// sites", "Saved changes to sid", "Created theme".
function describeChange(change) {
  if (change.kind === "edit") {
    return t("main_changeEdit", change.restore[0].name);
  }
  if (change.kind === "create") {
    return t("main_changeCreate", change.remove[0].name);
  }
  if (change.kind === "expiry") {
    return tn("main_changeExpiry", change.restore.length);
  }

  const affected = [...change.restore, ...change.remove];
  const sites = sitesOf(affected);
  const verb = change.kind === "import" ? "main_changeImported" : "main_changeDeleted";
  if (affected.length === 1) {
    return t(verb + "One", affected[0].name, sites[0]);
  }
  return sites.length === 1
    ? tn(verb + "From", affected.length, sites[0])
    : tn(verb + "Across", affected.length, formatCount(sites.length));
}

// On opening, offer to undo a change made in the last 10 minutes, unless
// something more important is already showing.
export async function offerStoredUndo() {
  const last = await loadLastChange();
  if (!last || el("main-message").textContent !== "") {
    return;
  }
  showMainMessage(t("main_undoOffer", describeChange(last), describeAge(Date.now() / 1000 - last.at)), false);
  appendUndoButton(el("main-message"));
}

// What Undo did, in words. A delete says "Restored 5 cookies." An edit says
// "Put sid back as it was." An import says "Removed 9 cookies and put back 3
// cookies."
function describeUndone(change, result) {
  const { removed, restored, failures } = result;
  if (change.kind === "delete") {
    return tn("main_undoRestored", restored);
  }
  if (change.kind === "edit" && restored === 1 && failures.length === 0) {
    return t("main_undoPutBackOne", change.restore[0].name);
  }
  if (change.kind === "create" && removed === 1) {
    return t("main_undoRemovedOne", change.remove[0].name);
  }

  if (removed > 0 && restored > 0) {
    return tn("main_undoRemovedAndPutBack", removed, tn("main_cookieCount", restored));
  }
  if (removed > 0) {
    return tn("main_undoRemoved", removed);
  }
  if (restored > 0) {
    return tn("main_undoPutBack", restored);
  }
  return t("main_undoNothing");
}

async function runUndo(message, button) {
  button.disabled = true;

  const last = await loadLastChange();
  if (!last) {
    message.className = "result error";
    message.textContent = t("main_undoTooLate");
    return;
  }

  message.className = "result";
  message.textContent = t("main_undoing");

  // Read the Kept list fresh, so Undo never removes a cookie kept since.
  const { keys } = await loadProtected();
  const result = await undoChange(last, (cookie) => isProtected(keys, cookie));
  await clearLastChange();
  // Cookies put back weren't cleared after all.
  if (last.kind === "delete") {
    await changeCleared(-result.restored);
    await refreshStats();
  }

  const parts = [describeUndone(last, result)];
  if (result.kept > 0) {
    parts.push(tn("main_undoKeptLeft", result.kept));
  }
  if (result.expired > 0) {
    parts.push(tn("main_undoExpiredSince", result.expired));
  }
  if (result.failures.length > 0) {
    parts.push(tn("main_undoRefused", result.failures.length, result.failures.join(" ")));
  }
  message.className = result.failures.length > 0 ? "result error" : "result";
  message.textContent = parts.join(" ");
  if (result.restored + result.removed > 0) {
    appendReloadButton(message);
  }

  await refresh();
}
