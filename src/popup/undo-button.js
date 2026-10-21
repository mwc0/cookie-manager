// The Undo and Reload the site buttons added after a change, and Undo
// itself. Every delete, save, import and expiry change ends up here.

import { sitesOf } from "../lib/cookies.js";
import { loadProtected, isProtected } from "../lib/protect.js";
import { pluralise, describeError } from "../lib/format.js";
import { changeCleared } from "../lib/stats.js";
import {
  saveLastChange,
  loadLastChange,
  clearLastChange,
  undoChange,
  describeAge,
} from "../lib/undo.js";
import { state } from "./state.js";
import { el, showMainMessage, describeSites } from "./ui.js";
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
  button.textContent = "Undo";
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
  button.textContent = "Reload the site";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await chrome.tabs.reload(tabId);
      button.textContent = "Reloaded";
    } catch (error) {
      button.textContent = "Couldn't reload it: " + describeError(error);
    }
  });
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
  if (change.kind === "expiry") {
    return "Changed when " + pluralise(change.restore.length, "cookie expires", "cookies expire");
  }

  const affected = [...change.restore, ...change.remove];
  const what =
    affected.length === 1 ? affected[0].name : pluralise(affected.length, "cookie", "cookies");
  const where = describeSites(sitesOf(affected));
  return (change.kind === "import" ? "Imported " : "Deleted ") + what + where;
}

// On opening, offer to undo a change made in the last 10 minutes, unless
// something more important is already showing.
export async function offerStoredUndo() {
  const last = await loadLastChange();
  if (!last || el("main-message").textContent !== "") {
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
  // Cookies put back weren't cleared after all.
  if (last.kind === "delete") {
    await changeCleared(-result.restored);
    await refreshStats();
  }

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
  if (result.restored + result.removed > 0) {
    appendReloadButton(message);
  }

  await refresh();
}
